import { DatabaseSync, backup } from "node:sqlite";
import { checkDatabase } from "./backup-lib.mjs";
import { existsSync, mkdirSync, chmodSync, unlinkSync, linkSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Restore into a NEW database only. This cannot overwrite the running database.
// Stop the application before replacing its data directory with the restored one.
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) {
  console.error("Usage : node scripts/restore.mjs sauvegarde.sqlite nouveau-dossier/atelier.sqlite");
  process.exitCode = 1;
} else {
  const source = resolve(sourceArg), target = resolve(targetArg);
  const temporary = `${target}.restore-${process.pid}`;
  try {
    if (!existsSync(source)) throw new Error("Sauvegarde introuvable.");
    if (source === target || existsSync(target) || existsSync(target + "-wal") || existsSync(target + "-shm"))
      throw new Error("Choisissez une nouvelle destination vide ; aucune base existante ne sera écrasée.");
    checkDatabase(source);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(source, { readOnly: true });
    try { await backup(db, temporary); } finally { db.close(); }
    checkDatabase(temporary);
    chmodSync(temporary, 0o600);
    // link() is exclusive: even a destination created concurrently is preserved.
    linkSync(temporary, target);
    unlinkSync(temporary);
    console.log(`Restauration complète vérifiée : ${target}`);
    console.log("Serveur arrêté : conservez l’ancienne base, puis utilisez le dossier restauré comme SCI_DATA_DIR.");
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    console.error(error.message);
    process.exitCode = 1;
  }
}
