import { recordStateChanges } from "./history.js";
const MAX_BYTES = 50 * 1024 * 1024;
const collections = { supplier: "suppliers", tenant: "tenants", lease: "leases" };

function stateFor(db, ownerId) {
  const row = db.prepare("SELECT state FROM users WHERE id=?").get(ownerId);
  return row ? JSON.parse(row.state) : null;
}
function documentRows(db, ownerId) {
  return [
    ...db.prepare("SELECT id,transaction_id,name,size_bytes,created_at FROM attachments WHERE user_id=?").all(ownerId)
      .map(row => ({ ...row, kind: "operation" })),
    ...db.prepare("SELECT id,kind,entity_id,name,size_bytes,created_at FROM entity_documents WHERE user_id=?").all(ownerId)
      .map(row => ({ ...row, entityKind: row.kind, kind: "entity" })),
  ];
}
function orphaned(row, state) {
  if (row.kind === "operation") return !(state.transactions || []).some(t => t.id === row.transaction_id);
  const collection = collections[row.entityKind];
  return !collection || !(state[collection] || []).some(entity => entity.id === row.entity_id);
}
const metadata = row => ({
  id: row.id, kind: row.kind, name: row.name, sizeBytes: row.size_bytes,
  createdAt: row.created_at, ...(row.entityKind ? { entityKind: row.entityKind } : {}),
});

export function storageSummary(db, ownerId) {
  const state = stateFor(db, ownerId);
  if (!state) return null;
  const rows = documentRows(db, ownerId);
  const operationBytes = rows.filter(row => row.kind === "operation").reduce((n,row) => n + row.size_bytes, 0);
  const entityBytes = rows.filter(row => row.kind === "entity").reduce((n,row) => n + row.size_bytes, 0);
  const orphans = rows.filter(row => orphaned(row, state));
  return { usedBytes: operationBytes + entityBytes, maxBytes: MAX_BYTES,
    operationBytes, entityBytes, orphanBytes: orphans.reduce((n,row) => n + row.size_bytes, 0), orphanCount: orphans.length };
}

export function installMaintenance(app, db, requireUser) {
  const requireOwner = (req,res,next) => {
    if ((req.actor?.id || req.user.id) !== req.user.id)
      return res.status(403).json({ error: "Seul le propriétaire de la SCI peut nettoyer les documents conservés." });
    next();
  };
  app.delete("/api/leases/:id", requireUser, requireOwner, (req,res,next) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const owner = db.prepare("SELECT state,revision FROM users WHERE id=?").get(req.user.id);
      if (!owner) {
        db.exec("ROLLBACK");
        return res.status(404).json({error:"La SCI est introuvable."});
      }
      const before = JSON.parse(owner.state);
      const lease = (before.leases || []).find(row => row.id === req.params.id);
      if (!lease) {
        db.exec("ROLLBACK");
        return res.status(404).json({error:"Cette location est introuvable."});
      }
      const linked = [...(before.transactions || []), ...(before.recurrences || [])].some(row => row.leaseId === lease.id);
      const documents = db.prepare("SELECT count(*) AS count FROM entity_documents WHERE user_id=? AND kind='lease' AND entity_id=?").get(req.user.id,lease.id).count;
      if (linked || documents || lease.rentChanges?.length) {
        db.exec("ROLLBACK");
        return res.status(409).json({error:"Cette location possède des opérations, documents ou changements de loyer. Conservez-la et utilisez la date de sortie pour préserver son historique."});
      }
      const after = structuredClone(before);
      after.leases = after.leases.filter(row => row.id !== lease.id);
      db.prepare("UPDATE users SET state=?,revision=revision+1 WHERE id=?").run(JSON.stringify(after),req.user.id);
      const actor = req.actor || req.user;
      recordStateChanges(db,{ownerId:req.user.id,actorId:actor.id,actorEmail:actor.email || "",before,after});
      db.exec("COMMIT");
      res.json({ok:true,state:after,revision:owner.revision+1});
    } catch (error) {
      db.exec("ROLLBACK");
      next(error);
    }
  });
  app.get("/api/storage", requireUser, (req,res) => {
    const summary = storageSummary(db,req.user.id);
    if (!summary) return res.status(404).json({error:"La SCI est introuvable."});
    res.json(summary);
  });
  app.get("/api/storage/orphans", requireUser, requireOwner, (req,res) => {
    const state = stateFor(db,req.user.id);
    if (!state) return res.status(404).json({error:"La SCI est introuvable."});
    res.json({orphans:documentRows(db,req.user.id).filter(row=>orphaned(row,state)).map(metadata)});
  });
  app.delete("/api/storage/orphans/:kind/:id", requireUser, requireOwner, (req,res) => {
    const state = stateFor(db,req.user.id);
    if (!state) return res.status(404).json({error:"La SCI est introuvable."});
    const row = documentRows(db,req.user.id).find(row=>row.kind===req.params.kind && row.id===req.params.id);
    if (!row || !orphaned(row,state)) return res.status(404).json({error:"Ce document conservé est introuvable ou de nouveau rattaché."});
    const table = row.kind === "operation" ? "attachments" : "entity_documents";
    db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(row.id,req.user.id);
    res.json({ok:true,...storageSummary(db,req.user.id)});
  });
}
