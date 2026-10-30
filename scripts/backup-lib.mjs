import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync, readdirSync, statSync, unlinkSync, existsSync, linkSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

export function checkDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("La vérification SQLite a échoué.");
    for (const table of ["users", "sessions"])
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        throw new Error(`La sauvegarde ne contient pas la table ${table}.`);
  } finally { db.close(); }
}

export async function createBackup({ source, target, directory } = {}) {
  source = resolve(source || resolve(process.env.SCI_DATA_DIR || "data", "atelier.sqlite"));
  directory = resolve(directory || process.env.SCI_BACKUP_DIR || resolve(dirname(source), "backups"));
  target = resolve(target || resolve(directory, `cap-sci-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`));
  if (!existsSync(source)) throw new Error("La base à sauvegarder est introuvable.");
  if (source === target || existsSync(target)) throw new Error("La destination doit être nouvelle et différente de la base active.");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.pending-${randomUUID()}`;
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, temporary);
    chmodSync(temporary, 0o600);
    checkDatabase(temporary);
    linkSync(temporary, target);
    return target;
  } finally {
    db.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function pruneBackups(directory, keep = 30) {
  if (!Number.isInteger(keep) || keep < 1 || keep > 1000) throw new Error("La rétention doit être comprise entre 1 et 1 000 sauvegardes.");
  const files = readdirSync(directory).filter(name => /^cap-sci-\d{4}-\d{2}-\d{2}T[\dZ.-]+\.sqlite$/.test(name))
    .map(name => resolve(directory, name)).filter(path => statSync(path).isFile()).sort().reverse();
  for (const file of files.slice(keep)) unlinkSync(file);
  return files.slice(keep).map(path => basename(path));
}
