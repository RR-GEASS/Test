import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";

const password = "shared-sci-test-password-2026";
async function harness(options = {}) {
  const { app, close } = createApp({ dbPath: ":memory:", production: false, authLimit: 1000, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { cookie = "", body, method = body ? "POST" : "GET", headers = {}, raw } = {}) {
    const response = await fetch(base + path, { method, headers: {
      Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers,
    }, ...(body ? { body: JSON.stringify(body) } : raw ? { body: raw } : {}) });
    const type = response.headers.get("content-type") || "";
    return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0], data: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }
  return { request, close: async () => { await new Promise(resolve => server.close(resolve)); close(); } };
}
const register = (h, email, extras = {}) => h.request("/api/register", { body: { email, password, name: "SCI commune", ...extras } });
const invite = (h, owner, email) => h.request("/api/access/invitations", { cookie: owner.cookie, body: { email } });
async function save(h, account, mutate, extras = {}) {
  const state = structuredClone(account.data.state);
  mutate(state);
  return h.request("/api/state", { method: "PUT", cookie: account.cookie, body: {
    state, revision: account.data.revision, accountId: account.data.user.id,
    ownerId: account.data.user.ownerId, ...extras,
  } });
}

test("deux identifiants partagent le même état et les mêmes justificatifs, avec un acteur distinct", async () => {
  const h = await harness();
  try {
    const owner = await register(h, "owner@access.test");
    const member = await register(h, "member@access.test");
    const outside = await register(h, "outside@access.test");
    const invitation = await invite(h, owner, "member@access.test");
    assert.equal(invitation.status, 201);
    const joined = await h.request("/api/access/accept", { cookie: member.cookie, body: { token: invitation.data.token } });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.user.id, member.data.user.id);
    assert.equal(joined.data.user.email, "member@access.test");
    assert.equal(joined.data.user.ownerId, owner.data.user.id);
    assert.equal(joined.data.user.role, "member");
    const updated = await save(h, owner, state => state.transactions.push({
      id: "shared-operation", type: "income", category: "contribution", date: "2026-01-01", status: "pending", propertyId: "", label: "Apport partagé", amountCents: 10000, counterparty: "Associé", reference: "", notes: "",
    }));
    assert.equal(updated.status, 200);
    const session = await h.request("/api/session", { cookie: member.cookie });
    assert.equal(session.data.state.transactions.length, 1);
    const uploaded = await h.request("/api/transactions/shared-operation/attachments", { cookie: member.cookie, method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": "preuve.pdf" }, raw: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF") });
    assert.equal(uploaded.status, 201);
    assert.equal((await h.request(`/api/attachments/${uploaded.data.attachment.id}`, { cookie: owner.cookie })).status, 200);
    assert.equal((await h.request(`/api/attachments/${uploaded.data.attachment.id}`, { cookie: outside.cookie })).status, 404);
    const memberWrite = await save(h, { ...session, cookie: member.cookie }, state => { state.transactions[0].notes = "Vérifié par le second accès"; });
    assert.equal(memberWrite.status, 200);
    const history = await h.request("/api/history", { cookie: owner.cookie });
    assert.ok(history.data.entries.some(entry => entry.actorEmail === "member@access.test"));
    const stale = await save(h, owner, state => { state.settings.name = "Ancienne révision"; });
    assert.equal(stale.status, 409);
    const outsider = await h.request("/api/session", { cookie: outside.cookie });
    assert.equal(outsider.data.state.transactions.length, 0);
  } finally { await h.close(); }
});

test("une invitation est liée à l’adresse, à usage unique et les membres ne gèrent pas les accès", async () => {
  const h = await harness();
  try {
    const owner = await register(h, "owner2@access.test");
    const member = await register(h, "member2@access.test");
    const wrong = await register(h, "wrong@access.test");
    const invitation = await invite(h, owner, "MEMBER2@access.test");
    assert.equal((await h.request("/api/access/accept", { cookie: wrong.cookie, body: { token: invitation.data.token } })).status, 403);
    assert.equal((await h.request("/api/access/accept", { cookie: member.cookie, body: { token: invitation.data.token } })).status, 200);
    assert.equal((await h.request("/api/access/accept", { cookie: member.cookie, body: { token: invitation.data.token } })).status, 403);
    assert.equal((await invite(h, member, "third@access.test")).status, 403);
    assert.equal((await invite(h, owner, "third@access.test")).status, 409);
    const memberAccess = await h.request("/api/access", { cookie: member.cookie });
    assert.equal(memberAccess.data.role, "member");
    assert.deepEqual(memberAccess.data.invitations, []);
    const ownerAccess = await h.request("/api/access", { cookie: owner.cookie });
    assert.equal(ownerAccess.data.members.length, 2);
    assert.equal((await h.request(`/api/access/members/${owner.data.user.id}`, { cookie: owner.cookie, method: "DELETE" })).status, 400);
    assert.equal((await h.request(`/api/access/members/${member.data.user.id}`, { cookie: member.cookie, method: "DELETE" })).status, 403);
    assert.equal((await h.request(`/api/access/members/${member.data.user.id}`, { cookie: owner.cookie, method: "DELETE" })).status, 200);
    assert.equal((await h.request("/api/session", { cookie: member.cookie })).status, 401);
    const login = await h.request("/api/login", { body: { email: "member2@access.test", password } });
    assert.equal(login.data.user.ownerId, member.data.user.id);
    const guarded = await save(h, { ...login, data: { ...login.data, user: { ...login.data.user, ownerId: owner.data.user.id } } }, () => {});
    assert.equal(guarded.status, 409);
    assert.equal(guarded.data.code, "account_changed");
  } finally { await h.close(); }
});

test("rejoindre une SCI ne masque jamais les données personnelles déjà enregistrées", async () => {
  const h = await harness();
  try {
    const owner = await register(h, "owner3@access.test");
    const member = await register(h, "occupied@access.test");
    const stored = await save(h, member, state => { state.settings.openingBalanceCents = 100; });
    assert.equal(stored.status, 200);
    const invitation = await invite(h, owner, "occupied@access.test");
    const denied = await h.request("/api/access/accept", { cookie: member.cookie, body: { token: invitation.data.token } });
    assert.equal(denied.status, 409);
    const own = await h.request("/api/session", { cookie: member.cookie });
    assert.equal(own.data.user.ownerId, member.data.user.id);
    assert.equal(own.data.state.settings.openingBalanceCents, 100);
  } finally { await h.close(); }
});

test("les inscriptions fermées permettent le premier propriétaire puis seulement une invitation valide", async () => {
  const h = await harness({ registrationMode: "closed" });
  try {
    const owner = await register(h, "first@access.test");
    assert.equal(owner.status, 201);
    assert.equal((await register(h, "blocked@access.test")).status, 403);
    const invitation = await invite(h, owner, "invited@access.test");
    assert.equal((await register(h, "wrong-target@access.test", { invitationToken: invitation.data.token })).status, 403);
    const invited = await register(h, "invited@access.test", { invitationToken: invitation.data.token });
    assert.equal(invited.status, 201);
    assert.equal(invited.data.user.ownerId, invited.data.user.id, "joining remains an explicit action");
    const accepted = await h.request("/api/access/accept", { cookie: invited.cookie, body: { token: invitation.data.token } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.user.ownerId, owner.data.user.id);
    const next = await invite(h, owner, "later@access.test");
    assert.equal(next.status, 409);
  } finally { await h.close(); }
});

test("les invitations expirées ou retirées sont refusées et les tokens ne sont pas stockés en clair", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capsci-access-"));
  const dbPath = join(dir, "test.sqlite");
  const h = await harness({ dbPath });
  try {
    const owner = await register(h, "expiry-owner@access.test");
    const member = await register(h, "expiry-member@access.test");
    const invitation = await invite(h, owner, "expiry-member@access.test");
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("SELECT token_hash FROM sci_invitations WHERE id=?").get(invitation.data.invitation.id);
      assert.notEqual(row.token_hash, invitation.data.token);
      db.prepare("UPDATE sci_invitations SET expires_at=0 WHERE id=?").run(invitation.data.invitation.id);
    } finally { db.close(); }
    assert.equal((await h.request("/api/access/accept", { cookie: member.cookie, body: { token: invitation.data.token } })).status, 403);
    const replacement = await invite(h, owner, "expiry-member@access.test");
    assert.equal((await h.request(`/api/access/invitations/${replacement.data.invitation.id}`, { cookie: owner.cookie, method: "DELETE" })).status, 200);
    assert.equal((await h.request("/api/access/accept", { cookie: member.cookie, body: { token: replacement.data.token } })).status, 403);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("changer son mot de passe conserve la session courante et invalide les autres sessions du compte", async () => {
  const h = await harness();
  try {
    const owner = await register(h, "password@access.test");
    const second = await h.request("/api/login", { body: { email: "password@access.test", password } });
    const invalid = await h.request("/api/account/password", { cookie: owner.cookie, body: { currentPassword: "wrong", newPassword: "new-shared-password-2026" } });
    assert.equal(invalid.status, 403);
    const changed = await h.request("/api/account/password", { cookie: owner.cookie, body: { currentPassword: password, newPassword: "new-shared-password-2026" } });
    assert.equal(changed.status, 200);
    assert.ok(changed.cookie);
    assert.equal((await h.request("/api/session", { cookie: owner.cookie })).status, 401);
    assert.equal((await h.request("/api/session", { cookie: second.cookie })).status, 401);
    assert.equal((await h.request("/api/session", { cookie: changed.cookie })).status, 200);
    assert.equal((await h.request("/api/login", { body: { email: "password@access.test", password } })).status, 401);
    assert.equal((await h.request("/api/login", { body: { email: "password@access.test", password: "new-shared-password-2026" } })).status, 200);
  } finally { await h.close(); }
});
