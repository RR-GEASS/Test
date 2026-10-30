import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

const password = "bank-api-test-password-2026";
const stamp = "2026-10-30T12:00:00.000Z";

async function harness(dbPath = ":memory:") {
  const { app, close } = createApp({ dbPath, production: false, authLimit: 1000 });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    async request(path, { body, cookie = "", method = body ? "POST" : "GET" } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0], data: await response.json() };
    },
    async close() { await new Promise(resolve => server.close(resolve)); close(); },
  };
}

const register = (h, email = "bank-owner@example.test") => h.request("/api/register", { body: { email, password, name: "SCI Banque" } });
const save = (h, account, state, revision = account.data.revision) => h.request("/api/state", {
  cookie: account.cookie, method: "PUT",
  body: { state, revision, accountId: account.data.user.id, ownerId: account.data.user.ownerId || account.data.user.id },
});

function importedState(account) {
  const state = structuredClone(account.data.state);
  state.transactions.push({
    id: "op-bank", type: "income", category: "other_income", date: "2026-10-05", status: "paid", propertyId: "",
    label: "Recette bancaire", amountCents: 10000, counterparty: "Associé des tests", reference: "", notes: "",
    payments: [{ id: "payment-bank", date: "2026-10-05", amountCents: 10000, rentCents: 0, chargesCents: 0 }],
  });
  state.bankImports = [{ id: "import-bank", name: "caisse-epargne-octobre.csv", importedAt: stamp }];
  state.bankLines = [{ id: "line-bank", importId: "import-bank", date: "2026-10-06", valueDate: "2026-10-07", label: "VIREMENT ASSOCIE", amountCents: 10000, reference: "BANK-001", sourceLineNumber: 2 }];
  state.bankMatches = [];
  return state;
}

const addMatch = state => {
  state.bankMatches = [{ id: "match-bank", bankLineId: "line-bank", validatedAt: stamp,
    allocations: [{ transactionId: "op-bank", paymentId: "payment-bank", amountCents: 10000 }] }];
  return state;
};

test("les imports et rapprochements sont persistés et audités sans ajouter de règlement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capsci-bank-api-"));
  const dbPath = join(dir, "bank.sqlite");
  let h = await harness(dbPath);
  try {
    const owner = await register(h);
    const imported = await save(h, owner, importedState(owner));
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    const linked = await save(h, owner, addMatch(structuredClone(imported.data.state)), imported.data.revision);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    assert.equal(linked.data.state.transactions[0].payments.length, 1);
    assert.equal(linked.data.state.transactions[0].payments[0].amountCents, 10000);
    const history = await h.request("/api/history", { cookie: owner.cookie });
    for (const entityType of ["bankImports", "bankLines", "bankMatches"])
      assert.ok(history.data.entries.some(entry => entry.entityType === entityType && entry.actorEmail === "bank-owner@example.test"));
    const matchEvent = history.data.entries.find(entry => entry.entityType === "bankMatches");
    assert.match(matchEvent.summary, /rapprochement bancaire.*VIREMENT ASSOCIE/);
    assert.equal(matchEvent.after.allocations[0].paymentId, "payment-bank");
    const outsider = await register(h, "bank-outside@example.test");
    assert.deepEqual(outsider.data.state.bankLines, []);
    assert.deepEqual((await h.request("/api/history", { cookie: outsider.cookie })).data.entries, []);
    const foreignIdentity = await h.request("/api/state", { cookie: outsider.cookie, method: "PUT", body: {
      state: linked.data.state, revision: outsider.data.revision, accountId: owner.data.user.id,
    } });
    assert.equal(foreignIdentity.status, 409);
    assert.deepEqual((await h.request("/api/session", { cookie: outsider.cookie })).data.state.bankMatches, []);
    await h.close();
    h = await harness(dbPath);
    const restored = await h.request("/api/session", { cookie: owner.cookie });
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data.state.bankMatches, linked.data.state.bankMatches);
    assert.deepEqual(restored.data.state.bankLines, linked.data.state.bankLines);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("l’API refuse les rapprochements incohérents et les montants bancaires réutilisés", async () => {
  const h = await harness();
  try {
    const owner = await register(h);
    const imported = await save(h, owner, importedState(owner));
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    const mutations = [
      state => { state.bankMatches[0].allocations[0].amountCents = 9999; },
      state => { state.bankMatches[0].allocations[0].paymentId = "missing-payment"; },
      state => { state.bankMatches[0].allocations[0].transactionId = "missing-operation"; },
      state => { state.bankMatches[0].validatedAt = "date invalide"; },
      state => { state.bankLines[0].amountCents = -10000; },
      state => { state.bankLines[0].date = "2026-02-30"; },
      state => {
        state.bankLines.push({ ...state.bankLines[0], id: "line-second", sourceLineNumber: 3 });
        state.bankMatches.push({ ...structuredClone(state.bankMatches[0]), id: "match-second", bankLineId: "line-second" });
      },
    ];
    for (const mutate of mutations) {
      const invalid = addMatch(structuredClone(imported.data.state)); mutate(invalid);
      const result = await save(h, owner, invalid, imported.data.revision);
      assert.equal(result.status, 400, JSON.stringify(result.data));
    }
    const session = await h.request("/api/session", { cookie: owner.cookie });
    assert.equal(session.data.revision, imported.data.revision);
    assert.deepEqual(session.data.state.bankMatches, []);
    assert.equal(session.data.state.bankLines.length, 1);
  } finally { await h.close(); }
});

test("un rapprochement doit être défait et enregistré avant la correction d’un règlement", async () => {
  const h = await harness();
  try {
    const owner = await register(h);
    const first = await save(h, owner, importedState(owner));
    const linked = await save(h, owner, addMatch(structuredClone(first.data.state)), first.data.revision);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    for (const mutate of [
      state => { state.bankLines[0].label = "AUTRE LIBELLE"; },
      state => { state.bankImports[0].name = "autre-fichier.csv"; },
      state => { state.bankMatches[0].validatedAt = "2026-10-31T12:00:00.000Z"; },
      state => { state.bankMatches[0].id = "match-replacement"; },
      state => {
        state.bankMatches = []; state.bankLines = []; state.bankImports = [];
      },
      state => {
        state.bankMatches = [];
        state.transactions[0].payments[0].date = "2026-10-07";
      },
      state => {
        state.bankMatches = [];
        state.transactions[0].payments = []; state.transactions[0].status = "pending";
      },
      state => {
        state.bankMatches = [];
        Object.assign(state.transactions[0], { cancelledAt: "2026-10-30", cancellationReason: "Erreur de saisie" });
      },
    ]) {
      const invalid = structuredClone(linked.data.state); mutate(invalid);
      const response = await save(h, owner, invalid, linked.data.revision);
      assert.equal(response.status, 400, JSON.stringify(response.data));
      assert.match(response.data.error, /bancaire|rapproch|import/i);
    }
    const unlink = structuredClone(linked.data.state); unlink.bankMatches = [];
    const unlinked = await save(h, owner, unlink, linked.data.revision);
    assert.equal(unlinked.status, 200, JSON.stringify(unlinked.data));
    const corrected = structuredClone(unlinked.data.state);
    Object.assign(corrected.transactions[0], { cancelledAt: "2026-10-30", cancellationReason: "Erreur de saisie" });
    const saved = await save(h, owner, corrected, unlinked.data.revision);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.state.transactions[0].payments.length, 1);
    const history = await h.request("/api/history", { cookie: owner.cookie });
    const unlinkEvent = history.data.entries.find(entry => entry.entityType === "bankMatches" && entry.action === "delete");
    assert.equal(unlinkEvent.before.allocations[0].paymentId, "payment-bank");
    assert.equal(unlinkEvent.after, null);
  } finally { await h.close(); }
});

test("un membre de la SCI peut rapprocher sans accéder aux données d’un autre espace", async () => {
  const h = await harness();
  try {
    const owner = await register(h), member = await register(h, "bank-member@example.test");
    const invitation = await h.request("/api/access/invitations", { cookie: owner.cookie, body: { email: "bank-member@example.test" } });
    assert.equal(invitation.status, 201);
    const joined = await h.request("/api/access/accept", { cookie: member.cookie, body: { token: invitation.data.token } });
    assert.equal(joined.status, 200);
    const imported = await save(h, owner, importedState(owner));
    assert.equal(imported.status, 200);
    const session = await h.request("/api/session", { cookie: member.cookie });
    const memberAccount = { cookie: member.cookie, data: session.data };
    const linked = await save(h, memberAccount, addMatch(structuredClone(session.data.state)));
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    const ownerSession = await h.request("/api/session", { cookie: owner.cookie });
    assert.equal(ownerSession.data.state.bankMatches.length, 1);
    const history = await h.request("/api/history", { cookie: owner.cookie });
    assert.ok(history.data.entries.some(entry => entry.entityType === "bankMatches" && entry.actorEmail === "bank-member@example.test"));
    const stale = await save(h, owner, imported.data.state, imported.data.revision);
    assert.equal(stale.status, 409);
  } finally { await h.close(); }
});

test("une ancienne sauvegarde sans données bancaires reste restaurable et les imports non rapprochés peuvent être supprimés", async () => {
  const h = await harness();
  try {
    const owner = await register(h);
    const legacy = structuredClone(owner.data.state);
    delete legacy.bankImports; delete legacy.bankLines; delete legacy.bankMatches;
    const restored = await h.request("/api/restore", { cookie: owner.cookie, body: {
      state: legacy, revision: owner.data.revision, accountId: owner.data.user.id, ownerId: owner.data.user.ownerId || owner.data.user.id,
    } });
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data.state.bankImports, []);
    assert.deepEqual(restored.data.state.bankLines, []);
    assert.deepEqual(restored.data.state.bankMatches, []);
    const imported = await save(h, owner, importedState(owner), restored.data.revision);
    assert.equal(imported.status, 200);
    const cleared = structuredClone(imported.data.state);
    cleared.bankImports = []; cleared.bankLines = [];
    const removed = await save(h, owner, cleared, imported.data.revision);
    assert.equal(removed.status, 200);
    assert.equal(removed.data.state.transactions[0].payments.length, 1);
  } finally { await h.close(); }
});
