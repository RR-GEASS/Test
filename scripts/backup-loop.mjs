import { createBackup, pruneBackups } from "./backup-lib.mjs";
import { resolve } from "node:path";
const hours = Number(process.env.SCI_BACKUP_INTERVAL_HOURS || 24);
const keep = Number(process.env.SCI_BACKUP_KEEP || 30);
if (!Number.isFinite(hours) || hours < 0.01 || hours > 8760 || !Number.isInteger(keep) || keep < 1 || keep > 1000)
  throw new Error("Paramètres de sauvegarde invalides.");
const directory = resolve(process.env.SCI_BACKUP_DIR || "data/backups");
let timer;
let stopped = false;
async function run() {
  try {
    const target = await createBackup({ directory });
    pruneBackups(directory, keep);
    console.log(`Sauvegarde complète vérifiée : ${target}`);
  } catch (error) { console.error(`Sauvegarde non effectuée : ${error.message}`); }
  if (!stopped) timer = setTimeout(run, hours * 3600000);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopped = true; clearTimeout(timer); });
await run();
