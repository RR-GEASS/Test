import { createBackup } from "./backup-lib.mjs";
try {
  const path = await createBackup({ target: process.argv[2] });
  console.log(`Sauvegarde complète vérifiée : ${path}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
