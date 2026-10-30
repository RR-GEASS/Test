import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.stdin.isTTY) {
  console.error("Fournissez l’e-mail en argument et le nouveau mot de passe sur l’entrée standard, sans argument de mot de passe.");
  process.exitCode = 1;
} else {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024) throw new Error("Entrée trop longue.");
  }
  const password = input.replace(/\r?\n$/, "");
  if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) {
    console.error("Le mot de passe doit contenir entre 12 et 128 caractères sur une seule ligne.");
    process.exitCode = 1;
  } else {
    const databasePath = resolve(process.env.SCI_DATA_DIR || "data", "atelier.sqlite");
    if (!existsSync(databasePath)) {
      console.error("La base du serveur est introuvable.");
      process.exit(1);
    }
    const db = new DatabaseSync(databasePath);
    try {
      const user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
      if (!user) throw new Error("Compte introuvable.");
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(password, salt, 64).toString("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=?").run(hash,salt,user.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      console.log("Mot de passe réinitialisé. Les anciennes sessions du compte ont été fermées.");
    } catch (error) { console.error(error.message); process.exitCode=1; }
    finally { db.close(); }
  }
}
