import { ZipArchive } from "archiver";
import { parseBackup, transactionLabel } from "../src/model.js";
import {
  accountantCSVs,
  exportSelection,
  parisToday,
} from "../src/accountant-export.js";
import { synchronizeAttachmentNames } from "./attachments.js";
import { documentBaseName, documentFileName } from "../src/document-names.js";

const GENERAL_FOLDER = "SCI - Général";
const pathKey = (value) => value.normalize("NFC").toLocaleLowerCase("fr");

/** Stable across filter selections, including sanitized/case-insensitive collisions. */
function propertyFolders(state) {
  const folders = new Map([["", GENERAL_FOLDER]]);
  const used = new Set([pathKey(GENERAL_FOLDER)]);
  const properties = [...state.properties].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const property of properties) {
    const base = documentBaseName(property.name, 50);
    let folder = base,
      sequence = 1;
    while (used.has(pathKey(folder))) {
      const suffix = ` (${++sequence})`;
      folder = documentBaseName(base, 50 - suffix.length) + suffix;
    }
    folders.set(property.id, folder);
    used.add(pathKey(folder));
  }
  return folders;
}

/** Export only the selected accounting tables and property/type document folders. */
export function installExports(app, db, requireUser) {
  app.post("/api/exports/accountant", requireUser, (req, res, next) => {
    let snapshot;
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const record = db
          .prepare("SELECT state FROM users WHERE id=?")
          .get(req.user.id);
        if (!record) throw new Error("Le compte est introuvable.");
        const state = parseBackup(record.state);
        const today = parisToday();
        const selection = exportSelection(state, req.body, { today });
        synchronizeAttachmentNames(db, req.user.id, state);
        const transactions = new Map(
          selection.transactions.map((t) => [t.id, t]),
        );
        const folders = propertyFolders(state);
        const directories = new Set();
        if (selection.options.includeDocuments) {
          for (const transaction of selection.transactions) {
            const property = folders.get(transaction.propertyId);
            directories.add(property + "/Encaissements/");
            directories.add(property + "/Décaissements/");
          }
        }
        const rows = db
          .prepare(
            "SELECT id,transaction_id,name,original_name,mime,size_bytes,created_at FROM attachments WHERE user_id=? ORDER BY created_at,id",
          )
          .all(req.user.id)
          .filter((row) => transactions.has(row.transaction_id));
        const usedPaths = new Set();
        const documents = rows.map((row) => {
          const transaction = transactions.get(row.transaction_id);
          const direction =
            transaction.type === "income" ? "Encaissements" : "Décaissements";
          const directory =
            folders.get(transaction.propertyId) + "/" + direction;
          // Leave room for the property/type path and suffixes when extracting on Windows.
          const label = documentBaseName(
            transactionLabel(transaction, state),
            Math.min(150, 190 - directory.length - 18),
          );
          let sequence = 1;
          let fileName = documentFileName(
            label,
            row.original_name || row.name,
            sequence,
          );
          let path = directory + "/" + fileName;
          while (usedPaths.has(pathKey(path))) {
            fileName = documentFileName(
              label,
              row.original_name || row.name,
              ++sequence,
            );
            path = directory + "/" + fileName;
          }
          usedPaths.add(pathKey(path));
          const data = selection.options.includeDocuments
            ? db
                .prepare(
                  "SELECT data FROM attachments WHERE id=? AND user_id=?",
                )
                .get(row.id, req.user.id)?.data
            : null;
          return {
            id: row.id,
            transactionId: row.transaction_id,
            name: fileName,
            originalName: row.original_name || row.name,
            mime: row.mime,
            size: row.size_bytes,
            createdAt: row.created_at,
            path: data ? path : null,
            ...(data ? { data: Buffer.from(data) } : {}),
          };
        });
        const csvs = accountantCSVs(state, selection, { documents, today });
        snapshot = {
          selection,
          documents,
          csvs,
          directories: [...directories],
        };
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      return res
        .status(400)
        .json({
          error: error.message || "La sélection d’export est invalide.",
        });
    }
    const archive = new ZipArchive({ store: true });
    let failed = false;
    const abort = (error) => {
      if (failed) return;
      failed = true;
      archive.abort();
      if (res.headersSent) res.destroy(error);
      else next(error);
    };
    archive.on("error", abort);
    archive.on("warning", abort);
    res.on("close", () => {
      if (!res.writableFinished) archive.abort();
    });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="cap-sci-comptable-${snapshot.selection.options.startDate}-${snapshot.selection.options.endDate}.zip"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    archive.pipe(res);
    for (const [name, text] of Object.entries(snapshot.csvs))
      archive.append(text, { name });
    for (const directory of snapshot.directories)
      archive.append(Buffer.alloc(0), { name: directory, type: "directory" });
    for (const doc of snapshot.documents)
      if (doc.data) archive.append(doc.data, { name: doc.path });
    archive.finalize().catch(abort);
  });
}
