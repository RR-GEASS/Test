import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { createApp } from "../server/app.js";
import { installHistory, recordStateChanges, validateProtectedChanges } from "../server/history.js";
import { createEmptyState } from "../src/model.js";

const password = "history-test-password-2026";
const legacyOperation = () => ({
  id: "legacy-paid", date: "2026-01-10", dueDate: "", type: "expense", status: "paid",
  category: "maintenance", propertyId: "", label: "Ancienne facture", amountCents: 15000,
  counterparty: "Ancien fournisseur", reference: "FAC-OLD", notes: "Pièce historique",
  payments: [{ id: "paid-1", date: "2026-01-10", amountCents: 15000, rentCents: 0, chargesCents: 0 }],
});
async function harness() {
  const { app, close } = createApp({ dbPath: ":memory:", production: false, allowTestFixtures: true });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async request(path, { body, cookie = "", method = body ? "POST" : "GET", origin = base } = {}) {
      const response = await fetch(base + path, { method,
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0], data: await response.json() };
    },
    async close() { await new Promise(resolve => server.close(resolve)); close(); },
  };
}
const register = (h, email = "history-owner@example.test") => h.request("/api/register", { body: { email, password, name: "SCI Historique" } });
const saveBody = (account, state = account.data.state, revision = account.data.revision) => ({ state, revision, accountId: account.data.user.id, ownerId: account.data.user.ownerId || account.data.user.id });

test("les opérations réglées s’annulent avec trace mais ne disparaissent pas silencieusement", () => {
  const before = { transactions: [legacyOperation()] };
  assert.throws(() => validateProtectedChanges(before, { transactions: [] }), /supprimée|supprimé/i);
  const modified = structuredClone(before); modified.transactions[0].amountCents = 16000;
  assert.throws(() => validateProtectedChanges(before, modified), /montant/i);
  const cancelled = structuredClone(before);
  Object.assign(cancelled.transactions[0], { cancelledAt: "2026-01-12", cancellationReason: "Doublon confirmé" });
  assert.doesNotThrow(() => validateProtectedChanges(before, cancelled));
  const lostPayments = structuredClone(cancelled); lostPayments.transactions[0].payments = [];
  assert.throws(() => validateProtectedChanges(before, lostPayments), /règlements/i);
  assert.throws(() => validateProtectedChanges(cancelled, before), /annulée/i);
  const correction = structuredClone(before); correction.transactions[0].payments = [];
  assert.doesNotThrow(() => validateProtectedChanges(before, correction));
});

test("l’audit contient l’acteur et les anciennes valeurs et suit la transaction SQLite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users(id) VALUES('owner')");
  installHistory(express(), db, (_req, _res, next) => next());
  const before = createEmptyState(), after = structuredClone(before);
  after.transactions.push(legacyOperation());
  db.exec("BEGIN");
  recordStateChanges(db, { ownerId: "owner", actorId: "member", actorEmail: "member@example.test", before, after });
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT count(*) AS total FROM audit_events").get().total, 0);
  recordStateChanges(db, { ownerId: "owner", actorId: "member", actorEmail: "member@example.test", before, after });
  const event = db.prepare("SELECT * FROM audit_events").get();
  assert.equal(event.actor_email, "member@example.test");
  assert.equal(event.entity_type, "transactions");
  assert.equal(JSON.parse(event.after_json).amountCents, 15000);
  assert.equal(event.before_json, null);
  assert.doesNotMatch(event.after_json, /password_hash|salt|token_hash/);
  const cancelled = structuredClone(after); Object.assign(cancelled.transactions[0], { cancelledAt: "2026-01-12", cancellationReason: "Erreur de saisie" });
  recordStateChanges(db, { ownerId: "owner", actorId: "member", actorEmail: "member@example.test", before: after, after: cancelled });
  const cancellation = db.prepare("SELECT * FROM audit_events WHERE action='cancel'").get();
  assert.equal(JSON.parse(cancellation.before_json).payments.length, 1);
  assert.equal(JSON.parse(cancellation.after_json).cancellationReason, "Erreur de saisie");
  db.close();
});

test("une ancienne sauvegarde se restaure explicitement avec instantané et contrôle de version", async () => {
  const h = await harness();
  try {
    const owner = await register(h);
    const legacy = structuredClone(owner.data.state); legacy.settings.name = "SCI ancienne sauvegarde"; legacy.transactions.push(legacyOperation());
    // Ordinary creation remains strict: a historical free-text supplier is not a new registered supplier.
    assert.equal((await h.request("/api/state", { method: "PUT", cookie: owner.cookie, body: saveBody(owner, legacy) })).status, 400);
    const restored = await h.request("/api/restore", { cookie: owner.cookie, body: saveBody(owner, legacy) });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.state.transactions[0].counterparty, "Ancien fournisseur");
    assert.equal(restored.data.revision, 1);
    const snapshots = await h.request("/api/restore/snapshots", { cookie: owner.cookie });
    assert.equal(snapshots.data.snapshots.length, 1);
    const snapshot = await h.request(`/api/restore/snapshots/${snapshots.data.snapshots[0].id}`, { cookie: owner.cookie });
    assert.equal(snapshot.data.state.settings.name, "SCI Historique");
    assert.equal(snapshot.data.state.transactions.length, 0);
    const stale = await h.request("/api/restore", { cookie: owner.cookie, body: saveBody(owner, owner.data.state) });
    assert.equal(stale.status, 409); assert.equal(stale.data.code, "conflict");
    assert.equal((await h.request("/api/restore/snapshots", { cookie: owner.cookie })).data.snapshots.length, 1);
    const history = await h.request("/api/history", { cookie: owner.cookie });
    assert.equal(history.status, 200);
    assert.equal(history.data.entries[0].action, "restore");
    assert.equal(history.data.entries[0].actorEmail, "history-owner@example.test");
    const current = await h.request("/api/session", { cookie: owner.cookie });
    assert.equal(current.data.state.settings.name, "SCI ancienne sauvegarde");
  } finally { await h.close(); }
});

test("l’historique, les instantanés et la restauration restent limités au bon espace", async () => {
  const h = await harness();
  try {
    const a = await register(h, "a-history@example.test"), b = await register(h, "b-history@example.test");
    assert.equal((await h.request("/api/history")).status, 401);
    const restored = await h.request("/api/restore", { cookie: a.cookie, body: saveBody(a) });
    assert.equal(restored.status, 200);
    assert.equal((await h.request("/api/history", { cookie: b.cookie })).data.entries.length, 0);
    assert.equal((await h.request(`/api/restore/snapshots/${restored.data.snapshotId}`, { cookie: b.cookie })).status, 404);
    assert.equal((await h.request("/api/restore", { cookie: b.cookie, body: saveBody(a) })).status, 409);
    assert.equal((await h.request("/api/restore", { cookie: a.cookie, origin: "https://elsewhere.test", body: saveBody(a, a.data.state, 1) })).status, 403);
    const wrongSpace = await h.request("/api/restore", { cookie: a.cookie, body: { ...saveBody(a, a.data.state, 1), ownerId: "former-shared-space" } });
    assert.equal(wrongSpace.status, 409);
  } finally { await h.close(); }
});

test("la suppression payée est refusée par l’API et son annulation préserve les règlements dans l’audit", async () => {
  const h = await harness();
  try {
    const a = await register(h), legacy = structuredClone(a.data.state); legacy.transactions.push(legacyOperation());
    const loaded = await h.request("/api/restore", { cookie: a.cookie, body: saveBody(a, legacy) });
    assert.equal(loaded.status, 200);
    const removed = structuredClone(loaded.data.state); removed.transactions = [];
    const denied = await h.request("/api/state", { method: "PUT", cookie: a.cookie, body: saveBody(a, removed, loaded.data.revision) });
    assert.equal(denied.status, 400); assert.match(denied.data.error, /supprim|annul/i);
    const cancelled = structuredClone(loaded.data.state);
    Object.assign(cancelled.transactions[0], { cancelledAt: "2026-01-12", cancellationReason: "Facture en double" });
    const saved = await h.request("/api/state", { method: "PUT", cookie: a.cookie, body: saveBody(a, cancelled, loaded.data.revision) });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.state.transactions[0].payments.length, 1);
    const history = await h.request("/api/history", { cookie: a.cookie });
    const event = history.data.entries.find(entry => entry.action === "cancel");
    assert.equal(event.before.payments[0].amountCents, 15000);
    assert.equal(event.after.cancellationReason, "Facture en double");
  } finally { await h.close(); }
});


test("restaurer puis retrouver une opération conserve les octets de ses justificatifs", async () => {
  const h = await harness();
  try {
    const a = await register(h), legacy = structuredClone(a.data.state); legacy.transactions.push(legacyOperation());
    const first = await h.request("/api/restore", { cookie: a.cookie, body: saveBody(a, legacy) });
    assert.equal(first.status, 200);
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const upload = await fetch(h.base + "/api/transactions/legacy-paid/attachments", {
      method: "POST", headers: { Origin: h.base, Cookie: a.cookie, "Content-Type": "application/octet-stream", "X-File-Name": "facture.pdf" }, body: bytes,
    });
    assert.equal(upload.status, 201); const document = (await upload.json()).attachment;
    const removed = await h.request("/api/restore", { cookie: a.cookie, body: saveBody(a, a.data.state, first.data.revision) });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(h.base + `/api/attachments/${document.id}`, { headers: { Cookie: a.cookie } })).status, 404);
    const restored = await h.request("/api/restore", { cookie: a.cookie, body: saveBody(a, first.data.state, removed.data.revision) });
    assert.equal(restored.status, 200);
    const file = await fetch(h.base + `/api/attachments/${document.id}`, { headers: { Cookie: a.cookie } });
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  } finally { await h.close(); }
});
