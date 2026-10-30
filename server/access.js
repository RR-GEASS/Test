import { createHash, randomBytes } from "node:crypto";

const hash = value => createHash("sha256").update(value).digest("hex");
const INVITATION_MS = 7 * 24 * 60 * 60 * 1000;
const validEmail = email => typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const error = (message, status = 400) => Object.assign(new Error(message), { status });

export function createAccess(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sci_memberships (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    CHECK(user_id <> owner_user_id)
  );
  CREATE INDEX IF NOT EXISTS memberships_owner ON sci_memberships(owner_user_id);
  CREATE TABLE IF NOT EXISTS sci_invitations (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    accepted_at INTEGER,
    revoked_at INTEGER
  );`);
  function resolve(actor) {
    const membership = db.prepare("SELECT owner_user_id FROM sci_memberships WHERE user_id=?").get(actor.id);
    const owner = membership ? db.prepare("SELECT * FROM users WHERE id=?").get(membership.owner_user_id) : actor;
    if (!owner) throw error("Cet espace partagé n’est plus accessible.", 403);
    return { actor, owner, role: membership ? "member" : "owner" };
  }
  function invitation(token, email) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.prepare("SELECT * FROM sci_invitations WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?").get(hash(token), Date.now());
    if (!row || (email && row.email !== email.trim().toLowerCase())) return null;
    return row;
  }
  function hasOwnData(actor) {
    const state = JSON.parse(actor.state);
    return ["properties", "transactions", "recurrences", "suppliers", "tenants", "leases", "bankChecks"].some(key => state[key]?.length) ||
      state.settings?.openingBalanceCents !== 0 ||
      !!db.prepare("SELECT 1 FROM sci_memberships WHERE owner_user_id=?").get(actor.id) ||
      !!db.prepare("SELECT 1 FROM attachments WHERE user_id=? LIMIT 1").get(actor.id) ||
      !!db.prepare("SELECT 1 FROM entity_documents WHERE user_id=? LIMIT 1").get(actor.id) ||
      !!db.prepare("SELECT 1 FROM restore_snapshots WHERE owner_id=? LIMIT 1").get(actor.id) ||
      !!db.prepare("SELECT 1 FROM audit_events WHERE owner_id=? LIMIT 1").get(actor.id);
  }
  function accept(actor, token) {
    const row = invitation(token, actor.email);
    if (!row) throw error("L’invitation est invalide, expirée ou destinée à une autre adresse.", 403);
    if (row.owner_user_id === actor.id) throw error("Vous possédez déjà cet espace.");
    const current = resolve(actor);
    if (current.owner.id !== actor.id) throw error("Ce compte appartient déjà à un espace partagé.", 409);
    if (hasOwnData(actor)) throw error("Ce compte contient déjà des données. Utilisez un compte vide pour rejoindre la SCI, afin de conserver vos données actuelles.", 409);
    if (db.prepare("SELECT count(*) AS n FROM sci_memberships WHERE owner_user_id=?").get(row.owner_user_id).n >= 1)
      throw error("Cette SCI dispose déjà de ses deux accès. Le propriétaire doit retirer un accès avant de vous inviter.", 409);
    if (db.prepare("SELECT 1 FROM sci_memberships WHERE user_id=?").get(row.owner_user_id))
      throw error("L’espace à rejoindre n’est plus disponible.", 409);
    db.prepare("INSERT INTO sci_memberships(user_id,owner_user_id,created_at) VALUES(?,?,?)").run(actor.id, row.owner_user_id, Date.now());
    db.prepare("UPDATE sci_invitations SET accepted_at=? WHERE id=?").run(Date.now(), row.id);
    return resolve(actor);
  }
  function ownerOnly(req, res, next) {
    if (req.actor.id !== req.user.id) return res.status(403).json({ error: "Seul le propriétaire peut gérer les accès de cette SCI." });
    next();
  }
  function install(app, requireUser, payload) {
    app.get("/api/access", requireUser, (req, res) => {
      const owner = req.actor.id === req.user.id;
      const base = { role: owner ? "owner" : "member", ownerId: req.user.id, ownerEmail: req.user.email };
      if (!owner) return res.json({ ...base, members: [], invitations: [] });
      const members = [
        { id: req.user.id, email: req.user.email, role: "owner" },
        ...db.prepare("SELECT users.id,users.email FROM sci_memberships JOIN users ON users.id=sci_memberships.user_id WHERE owner_user_id=? ORDER BY created_at").all(req.user.id).map(user => ({ ...user, role: "member" })),
      ];
      const invitations = db.prepare("SELECT id,email,expires_at AS expiresAt FROM sci_invitations WHERE owner_user_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC").all(req.user.id, Date.now());
      res.json({ ...base, members, invitations });
    });
    app.post("/api/access/invitations", requireUser, ownerOnly, (req, res) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!validEmail(email)) return res.status(400).json({ error: "Renseignez une adresse e-mail valide." });
      if (email === req.user.email) return res.status(400).json({ error: "Votre compte possède déjà cet espace." });
      if (db.prepare("SELECT count(*) AS n FROM sci_memberships WHERE owner_user_id=?").get(req.user.id).n >= 1)
        return res.status(409).json({ error: "Les deux accès de cette SCI sont déjà attribués." });
      const token = randomBytes(32).toString("hex");
      const id = randomBytes(16).toString("hex");
      const expiresAt = Date.now() + INVITATION_MS;
      db.prepare("UPDATE sci_invitations SET revoked_at=? WHERE owner_user_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL").run(Date.now(), req.user.id, email);
      db.prepare("INSERT INTO sci_invitations(id,owner_user_id,email,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)").run(id, req.user.id, email, hash(token), Date.now(), expiresAt);
      res.status(201).json({ invitation: { id, email, expiresAt }, token, url: `/?invite=${token}` });
    });
    app.delete("/api/access/invitations/:id", requireUser, ownerOnly, (req, res) => {
      const changed = db.prepare("UPDATE sci_invitations SET revoked_at=? WHERE id=? AND owner_user_id=? AND accepted_at IS NULL AND revoked_at IS NULL").run(Date.now(), req.params.id, req.user.id);
      if (!changed.changes) return res.status(404).json({ error: "Cette invitation est introuvable." });
      res.json({ ok: true });
    });
    app.post("/api/access/accept", requireUser, (req, res) => {
      try {
        db.exec("BEGIN IMMEDIATE");
        accept(req.actor, req.body?.token);
        db.exec("COMMIT");
        res.json(payload(req.actor));
      } catch (e) {
        if (db.isTransaction) db.exec("ROLLBACK");
        res.status(e.status || 400).json({ error: e.message });
      }
    });
    app.delete("/api/access/members/:id", requireUser, ownerOnly, (req, res) => {
      if (req.params.id === req.user.id) return res.status(400).json({ error: "Le propriétaire ne peut pas retirer son propre accès." });
      db.exec("BEGIN IMMEDIATE");
      try {
        const changed = db.prepare("DELETE FROM sci_memberships WHERE user_id=? AND owner_user_id=?").run(req.params.id, req.user.id);
        if (!changed.changes) { db.exec("ROLLBACK"); return res.status(404).json({ error: "Cet accès est introuvable." }); }
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.params.id);
        db.exec("COMMIT");
        res.json({ ok: true });
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    });
  }
  return { resolve, invitation, accept, install };
}
