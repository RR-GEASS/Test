import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
const source = resolve(process.env.SCI_DATA_DIR || "data", "atelier.sqlite");
const target = resolve(
  process.argv[2] ||
    resolve(
      dirname(source),
      "backups",
      `atelier-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
    ),
);
if (source === target)
  throw new Error("La destination doit différer de la base active.");
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  chmodSync(target, 0o600);
  console.log(`Sauvegarde cohérente créée : ${target}`);
} finally {
  db.close();
}
