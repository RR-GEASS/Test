import express from "express";
import { randomUUID } from "node:crypto";
import { parseBackup, transactionLabel } from "../src/model.js";
import { documentFileName } from "../src/document-names.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 50 * 1024 * 1024;
const MAX_TRANSACTION_FILES = 20;

export function decodeName(header) {
  if (typeof header !== "string") return null;
  let name;
  try {
    name = decodeURIComponent(header).trim();
  } catch {
    return null;
  }
  if (
    !name ||
    name.length > 160 ||
    /[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)
  )
    return null;
  return name;
}

export function detectDocument(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 8 &&
    /^%PDF-[12]\.\d/.test(buffer.subarray(0, 8).toString("ascii")) &&
    buffer
      .subarray(Math.max(0, buffer.length - 1024))
      .includes(Buffer.from("%%EOF"))
  )
    return { mime: "application/pdf", extensions: ["pdf"] };
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  )
    return { mime: "image/jpeg", extensions: ["jpg", "jpeg"] };
  if (
    buffer.length >= 24 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.readUInt32BE(8) === 13 &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR"
  )
    return { mime: "image/png", extensions: ["png"] };
  return null;
}

export function disposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Both operation and directory documents share the account storage limit. */
export function accountDocumentBytes(db, userId) {
  const operations = db.prepare("SELECT coalesce(sum(size_bytes),0) AS total FROM attachments WHERE user_id=?").get(userId).total;
  const hasDirectoryDocuments = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entity_documents'").get();
  const directory = hasDirectoryDocuments
    ? db.prepare("SELECT coalesce(sum(size_bytes),0) AS total FROM entity_documents WHERE user_id=?").get(userId).total
    : 0;
  return operations + directory;
}

/** Align names with the current operation label without modifying document bytes.
 * Keeping the original name also preserves its actual extension for later renames.
 */
export function synchronizeAttachmentNames(db, userId, state) {
  if (!state) {
    const owner = db.prepare("SELECT state FROM users WHERE id=?").get(userId);
    if (!owner) return 0;
    try {
      state = parseBackup(owner.state);
    } catch {
      return 0;
    }
  }
  const operations = new Map(state.transactions.map((t) => [t.id, t]));
  const rows = db
    .prepare(
      "SELECT id,transaction_id,name,original_name,mime,created_at FROM attachments WHERE user_id=? ORDER BY transaction_id,created_at,id",
    )
    .all(userId);
  const update = db.prepare(
    "UPDATE attachments SET name=?,original_name=? WHERE id=? AND user_id=?",
  );
  const sequences = new Map();
  let changed = 0;
  for (const row of rows) {
    const originalName = row.original_name || row.name;
    const operation = operations.get(row.transaction_id);
    // Orphaned files stay intact so restoring an operation can restore access.
    if (!operation) {
      if (!row.original_name)
        update.run(row.name, originalName, row.id, userId);
      continue;
    }
    const sequence = (sequences.get(row.transaction_id) || 0) + 1;
    sequences.set(row.transaction_id, sequence);
    const extensionSource = /\.(pdf|jpe?g|png)$/iu.test(originalName)
      ? originalName
      : { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" }[
          row.mime
        ];
    if (!extensionSource) continue;
    const name = documentFileName(
      transactionLabel(operation, state),
      extensionSource,
      sequence,
    );
    if (name !== row.name || !row.original_name) {
      update.run(name, originalName, row.id, userId);
      changed++;
    }
  }
  return changed;
}

/** Install authenticated supporting-document routes on the existing SCI API. */
export function installAttachments(app, db, requireUser) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL,
      name TEXT NOT NULL,
      original_name TEXT,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 5242880),
      created_at TEXT NOT NULL,
      data BLOB NOT NULL CHECK(length(data) = size_bytes)
    );
    CREATE INDEX IF NOT EXISTS attachments_owner_transaction ON attachments(user_id, transaction_id);
  `);

  if (
    !db
      .prepare("PRAGMA table_info(attachments)")
      .all()
      .some((column) => column.name === "original_name")
  ) {
    db.exec("ALTER TABLE attachments ADD COLUMN original_name TEXT");
  }

  // Read the current database state rather than the authentication snapshot:
  // another request can remove an operation while an upload is still arriving.
  function hasTransaction(userId, transactionId) {
    const record = db.prepare("SELECT state FROM users WHERE id=?").get(userId);
    if (!record) return false;
    try {
      const state = JSON.parse(record.state);
      return (
        Array.isArray(state.transactions) &&
        state.transactions.some((t) => t.id === transactionId)
      );
    } catch {
      return false;
    }
  }

  function ownsTransaction(req, res, next) {
    if (!hasTransaction(req.user.id, req.params.transactionId))
      return res
        .status(404)
        .json({ error: "Cette opération est introuvable." });
    next();
  }

  const rawFile = express.raw({
    type: "application/octet-stream",
    limit: MAX_FILE_BYTES,
  });
  function receiveFile(req, res, next) {
    if (!req.is("application/octet-stream"))
      return res
        .status(415)
        .json({ error: "Envoyez le fichier en application/octet-stream." });
    rawFile(req, res, (error) => {
      if (error?.type === "entity.too.large")
        return res.status(413).json({ error: "Le justificatif dépasse 5 Mo." });
      if (error) return next(error);
      next();
    });
  }

  const metadata = (row) => ({
    id: row.id,
    name: row.name,
    originalName: row.original_name || row.name,
    mime: row.mime,
    size: row.size_bytes,
    createdAt: row.created_at,
  });

  app.get("/api/attachments/summary", requireUser, (req, res) => {
    const record = db.prepare("SELECT state FROM users WHERE id=?").get(req.user.id);
    const state = JSON.parse(record.state);
    const transactionIds = new Set(state.transactions.map((t) => t.id));
    const counts = Object.create(null);
    const rows = db.prepare(
      "SELECT transaction_id, count(*) AS count FROM attachments WHERE user_id=? GROUP BY transaction_id",
    ).all(req.user.id);
    for (const row of rows)
      if (transactionIds.has(row.transaction_id)) counts[row.transaction_id] = row.count;
    res.json({ counts });
  });

  app.get(
    "/api/transactions/:transactionId/attachments",
    requireUser,
    ownsTransaction,
    (req, res) => {
      synchronizeAttachmentNames(db, req.user.id);
      const rows = db
        .prepare(
          "SELECT id,name,original_name,mime,size_bytes,created_at FROM attachments WHERE user_id=? AND transaction_id=? ORDER BY created_at,id",
        )
        .all(req.user.id, req.params.transactionId);
      res.json({ attachments: rows.map(metadata) });
    },
  );

  app.post(
    "/api/transactions/:transactionId/attachments",
    requireUser,
    receiveFile,
    ownsTransaction,
    (req, res) => {
      const originalName = decodeName(req.get("x-file-name"));
      if (!originalName)
        return res.status(400).json({
          error:
            "Le nom du fichier est invalide (160 caractères maximum, sans chemin).",
        });
      const detected = detectDocument(req.body);
      const extension = originalName.split(".").at(-1).toLowerCase();
      if (!detected || !detected.extensions.includes(extension))
        return res.status(415).json({
          error:
            "Choisissez un véritable fichier PDF, JPEG ou PNG avec l’extension correspondante.",
        });
      const count = db
        .prepare(
          "SELECT count(*) AS total FROM attachments WHERE user_id=? AND transaction_id=?",
        )
        .get(req.user.id, req.params.transactionId).total;
      if (count >= MAX_TRANSACTION_FILES)
        return res
          .status(409)
          .json({ error: "Cette opération contient déjà 20 justificatifs." });
      const used = accountDocumentBytes(db, req.user.id);
      if (used + req.body.length > MAX_ACCOUNT_BYTES)
        return res.status(409).json({
          error: "L’espace de justificatifs de ce compte est limité à 50 Mo.",
        });
      synchronizeAttachmentNames(db, req.user.id);
      const ownerState = parseBackup(
        db.prepare("SELECT state FROM users WHERE id=?").get(req.user.id).state,
      );
      const operation = ownerState.transactions.find(
        (t) => t.id === req.params.transactionId,
      );
      const name = documentFileName(
        transactionLabel(operation, ownerState),
        originalName,
        count + 1,
      );
      const attachment = {
        id: randomUUID(),
        name,
        originalName,
        mime: detected.mime,
        size: req.body.length,
        createdAt: new Date().toISOString(),
      };
      db.prepare(
        "INSERT INTO attachments(id,user_id,transaction_id,name,original_name,mime,size_bytes,created_at,data) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        attachment.id,
        req.user.id,
        req.params.transactionId,
        name,
        originalName,
        detected.mime,
        req.body.length,
        attachment.createdAt,
        req.body,
      );
      synchronizeAttachmentNames(db, req.user.id, ownerState);
      const inserted = db
        .prepare(
          "SELECT id,name,original_name,mime,size_bytes,created_at FROM attachments WHERE id=? AND user_id=?",
        )
        .get(attachment.id, req.user.id);
      res.status(201).json({ attachment: metadata(inserted) });
    },
  );

  function findAttachment(req, res, next) {
    synchronizeAttachmentNames(db, req.user.id);
    const row = db
      .prepare("SELECT * FROM attachments WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
    if (!row || !hasTransaction(req.user.id, row.transaction_id))
      return res
        .status(404)
        .json({ error: "Ce justificatif est introuvable." });
    req.attachment = row;
    next();
  }

  app.get("/api/attachments/:id", requireUser, findAttachment, (req, res) => {
    res.set({
      "Content-Type": req.attachment.mime,
      "Content-Disposition": disposition(req.attachment.name),
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(req.attachment.size_bytes),
    });
    res.send(Buffer.from(req.attachment.data));
  });

  app.delete(
    "/api/attachments/:id",
    requireUser,
    findAttachment,
    (req, res) => {
      db.prepare("DELETE FROM attachments WHERE id=? AND user_id=?").run(
        req.attachment.id,
        req.user.id,
      );
      res.json({ ok: true });
    },
  );
}
