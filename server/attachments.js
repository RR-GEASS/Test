import express from "express";
import { randomUUID } from "node:crypto";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 50 * 1024 * 1024;
const MAX_TRANSACTION_FILES = 20;

function decodeName(header) {
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

function detectDocument(buffer) {
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

function disposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Install authenticated supporting-document routes on the existing SCI API. */
export function installAttachments(app, db, requireUser) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 5242880),
      created_at TEXT NOT NULL,
      data BLOB NOT NULL CHECK(length(data) = size_bytes)
    );
    CREATE INDEX IF NOT EXISTS attachments_owner_transaction ON attachments(user_id, transaction_id);
  `);

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
    mime: row.mime,
    size: row.size_bytes,
    createdAt: row.created_at,
  });

  app.get(
    "/api/transactions/:transactionId/attachments",
    requireUser,
    ownsTransaction,
    (req, res) => {
      const rows = db
        .prepare(
          "SELECT id,name,mime,size_bytes,created_at FROM attachments WHERE user_id=? AND transaction_id=? ORDER BY created_at,id",
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
      const name = decodeName(req.get("x-file-name"));
      if (!name)
        return res.status(400).json({
          error:
            "Le nom du fichier est invalide (160 caractères maximum, sans chemin).",
        });
      const detected = detectDocument(req.body);
      const extension = name.split(".").at(-1).toLowerCase();
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
      const used = db
        .prepare(
          "SELECT coalesce(sum(size_bytes),0) AS total FROM attachments WHERE user_id=?",
        )
        .get(req.user.id).total;
      if (used + req.body.length > MAX_ACCOUNT_BYTES)
        return res.status(409).json({
          error: "L’espace de justificatifs de ce compte est limité à 50 Mo.",
        });
      const attachment = {
        id: randomUUID(),
        name,
        mime: detected.mime,
        size: req.body.length,
        createdAt: new Date().toISOString(),
      };
      db.prepare(
        "INSERT INTO attachments(id,user_id,transaction_id,name,mime,size_bytes,created_at,data) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        attachment.id,
        req.user.id,
        req.params.transactionId,
        name,
        detected.mime,
        req.body.length,
        attachment.createdAt,
        req.body,
      );
      res.status(201).json({ attachment });
    },
  );

  function findAttachment(req, res, next) {
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
