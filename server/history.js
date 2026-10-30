import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseBackup, generateRecurringTransactions, monthEnd } from "../src/model.js";
import { synchronizeAttachmentNames } from "./attachments.js";

const collections = {
  properties: "bien", suppliers: "fournisseur", tenants: "locataire",
  leases: "location", transactions: "opération", recurrences: "périodicité",
  bankChecks: "contrôle bancaire",
};
const actionNames = { create: "Création", update: "Modification", delete: "Suppression", cancel: "Annulation", payment: "Règlements modifiés" };
const hasPayments = (operation) => Array.isArray(operation.payments)
  ? operation.payments.some((payment) => payment.amountCents > 0)
  : operation.status === "paid";
const parisToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());

/** Economic corrections to settled operations must remain traceable. */
export function validateProtectedChanges(before, after) {
  const next = new Map((after.transactions || []).map((operation) => [operation.id, operation]));
  for (const previous of before.transactions || []) {
    const current = next.get(previous.id);
    if (!current) {
      if (hasPayments(previous) || previous.cancelledAt)
        throw new Error("Une opération réglée ou annulée ne peut pas être supprimée. Annulez-la avec un motif pour conserver son historique.");
      continue;
    }
    if (previous.cancelledAt && (!current.cancelledAt || current.cancelledAt !== previous.cancelledAt))
      throw new Error("Une opération annulée doit rester conservée. Créez une nouvelle opération pour la remplacer.");
    if (hasPayments(previous)) {
      for (const field of ["type", "category", "propertyId", "amountCents", "rentCents", "chargesCents"]) {
        const original = previous[field] ?? (field === "rentCents" && previous.category === "rent" ? previous.amountCents : field.endsWith("Cents") ? 0 : "");
        const changed = current[field] ?? (field === "rentCents" && current.category === "rent" ? current.amountCents : field.endsWith("Cents") ? 0 : "");
        if (original !== changed)
          throw new Error("Une opération déjà réglée doit conserver son montant, son bien et sa catégorie. Annulez les règlements erronés avant de la corriger.");
      }
    }
    if (!previous.cancelledAt && current.cancelledAt) {
      if (!current.cancellationReason?.trim())
        throw new Error("Indiquez le motif de l’annulation.");
      if (!isDeepStrictEqual(previous.payments, current.payments))
        throw new Error("L’annulation doit conserver les règlements d’origine dans l’historique.");
    }
  }
}

function initializeHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    created_at TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_events_owner_date ON audit_events(owner_id,created_at);
  CREATE TABLE IF NOT EXISTS restore_snapshots (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revision INTEGER NOT NULL,
    name TEXT NOT NULL,
    state TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS restore_snapshots_owner_date ON restore_snapshots(owner_id,created_at);`);
}

/** Called in the same transaction as the state write: an audit cannot describe
 * a change that failed to commit. Only business data is recorded, never auth. */
export function recordStateChanges(db, { ownerId, actorId, actorEmail, before, after, action = "save" }) {
  const insert = db.prepare(`INSERT INTO audit_events
    (id,owner_id,actor_id,actor_email,created_at,action,entity_type,entity_id,summary,before_json,after_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const createdAt = new Date().toISOString();
  let count = 0;
  const add = (change, type, id, summary, original, current) => {
    insert.run(randomUUID(), ownerId, actorId || ownerId, actorEmail || "", createdAt,
      change, type, id, summary.slice(0, 600),
      original === undefined ? null : JSON.stringify(original),
      current === undefined ? null : JSON.stringify(current));
    count++;
  };
  if (action === "restore") {
    add("restore", "sci", ownerId, "Restauration d’une sauvegarde ; un instantané de l’état précédent a été conservé.",
      { name: before.settings?.name, operationCount: before.transactions?.length || 0 },
      { name: after.settings?.name, operationCount: after.transactions?.length || 0 });
    return count;
  }
  if (!isDeepStrictEqual(before.settings, after.settings))
    add("update", "settings", ownerId, "Modification des paramètres de la SCI", before.settings, after.settings);
  for (const [key, label] of Object.entries(collections)) {
    const original = new Map((before[key] || []).map((row) => [row.id, row]));
    const current = new Map((after[key] || []).map((row) => [row.id, row]));
    for (const id of new Set([...original.keys(), ...current.keys()])) {
      const left = original.get(id), right = current.get(id);
      if (isDeepStrictEqual(left, right)) continue;
      let change = !left ? "create" : !right ? "delete" : "update";
      if (key === "transactions" && left && right) {
        if (!left.cancelledAt && right.cancelledAt) change = "cancel";
        else if (!isDeepStrictEqual(left.payments, right.payments)) change = "payment";
      }
      const display = right?.label || left?.label || right?.name || left?.name || id;
      add(change, key, id, `${actionNames[change]} ${label} : ${display}`, left, right);
    }
  }
  return count;
}

const actorFor = (req) => req.actor || req.user;
const ownerOnly = (req, res, next) => {
  const actor = actorFor(req);
  if ((req.accessRole && req.accessRole !== "owner") || actor.id !== req.user.id)
    return res.status(403).json({ error: "Seul le propriétaire de la SCI peut restaurer une sauvegarde." });
  next();
};

export function installHistory(app, db, requireUser) {
  initializeHistory(db);
  app.get("/api/history", requireUser, (req, res) => {
    const rows = db.prepare(`SELECT id,created_at,actor_email,action,entity_type,entity_id,summary,before_json,after_json
      FROM audit_events WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200`).all(req.user.id);
    res.json({ entries: rows.map((row) => ({
      id: row.id, createdAt: row.created_at, actorEmail: row.actor_email,
      action: row.action, entityType: row.entity_type, entityId: row.entity_id,
      summary: row.summary, before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
    })) });
  });
  app.get("/api/restore/snapshots", requireUser, ownerOnly, (req, res) => {
    const rows = db.prepare(`SELECT id,created_at,actor_email,name,revision FROM restore_snapshots
      WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10`).all(req.user.id);
    res.json({ snapshots: rows.map((row) => ({ id: row.id, createdAt: row.created_at,
      actorEmail: row.actor_email, name: row.name, revision: row.revision })) });
  });
  app.get("/api/restore/snapshots/:id", requireUser, ownerOnly, (req, res) => {
    const row = db.prepare("SELECT id,created_at,revision,state FROM restore_snapshots WHERE id=? AND owner_id=?")
      .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: "Cet instantané est introuvable." });
    res.json({ id: row.id, createdAt: row.created_at, revision: row.revision, state: JSON.parse(row.state) });
  });
  app.post("/api/restore", requireUser, ownerOnly, (req, res, next) => {
    const actor = actorFor(req);
    const { state: input, revision, accountId, ownerId } = req.body || {};
    if (accountId !== actor.id || (ownerId !== undefined && ownerId !== req.user.id))
      return res.status(409).json({ error: "L’espace connecté a changé. Rechargez les données avant de restaurer.", code: "account_changed" });
    if (!Number.isSafeInteger(revision) || revision < 0)
      return res.status(400).json({ error: "Version des données invalide." });
    let state;
    try {
      // Explicit restore accepts the older structural schema. New-entry rules
      // continue to apply exclusively to ordinary creation and modification.
      state = parseBackup(input);
      state.mode = "real";
      generateRecurringTransactions(state, monthEnd(parisToday()));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT state,revision FROM users WHERE id=?").get(req.user.id);
      if (!current || current.revision !== revision) {
        db.exec("ROLLBACK");
        return res.status(409).json({ error: "Votre SCI a été modifiée sur un autre appareil. Rechargez les données avant de restaurer.", code: "conflict" });
      }
      const before = JSON.parse(current.state);
      const snapshotId = randomUUID();
      db.prepare(`INSERT INTO restore_snapshots(id,owner_id,actor_id,actor_email,created_at,revision,name,state)
        VALUES(?,?,?,?,?,?,?,?)`).run(snapshotId, req.user.id, actor.id, actor.email,
        new Date().toISOString(), current.revision, before.settings?.name || "SCI", current.state);
      db.prepare("UPDATE users SET state=?,revision=revision+1 WHERE id=? AND revision=?")
        .run(JSON.stringify(state), req.user.id, revision);
      synchronizeAttachmentNames(db, req.user.id, state);
      recordStateChanges(db, { ownerId: req.user.id, actorId: actor.id, actorEmail: actor.email, before, after: state, action: "restore" });
      // Keep a bounded safety net in the database; independent full backups
      // remain necessary to survive a lost disk or damaged database.
      db.prepare(`DELETE FROM restore_snapshots WHERE owner_id=? AND id NOT IN
        (SELECT id FROM restore_snapshots WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10)`)
        .run(req.user.id, req.user.id);
      db.exec("COMMIT");
      res.json({ revision: revision + 1, state, snapshotId, ownerId: req.user.id });
    } catch (error) {
      db.exec("ROLLBACK");
      next(error);
    }
  });
}
