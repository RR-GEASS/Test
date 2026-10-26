import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
import { validateSupplier, validateTenant, validateLease } from "../src/model.js";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "capsci-entity-documents-"));
  const dbPath = join(directory, "test.sqlite");
  const { app, close } = createApp({ dbPath, production: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    dbPath,
    async request(path, { method, body, cookie = "", origin = base, headers = {} } = {}) {
      const binary = Buffer.isBuffer(body);
      const response = await fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : {}), ...headers },
        ...(body ? { body: binary ? body : JSON.stringify(body) } : {}),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        data: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : null };
    },
    async close() { await new Promise(resolve => server.close(resolve)); close(); await rm(directory, { recursive: true, force: true }); },
  };
}
async function account(h, email) {
  const response = await h.request("/api/register", { body: { email, password: "directory-documents-password", name: "SCI documents" } });
  assert.equal(response.status, 201);
  return { cookie: response.cookie, ...response.data };
}
async function save(h, owner) {
  const result = await h.request("/api/state", { method: "PUT", cookie: owner.cookie, body: { accountId: owner.user.id, revision: owner.revision, state: owner.state } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  owner.revision = result.data.revision;
}
async function fixtures(h, owner) {
  owner.state.properties.push({ id: "property", name: "République T2", address: "", tenant: "", rentCents: 80000, chargesCents: 5000, archived: false });
  owner.state.suppliers.push(validateSupplier({ id: "supplier", name: "Banque du prêt" }, owner.state).value);
  owner.state.tenants.push(validateTenant({ id: "tenant", name: "Camille Martin" }).value);
  owner.state.leases.push(validateLease({ id: "lease", tenantId: "tenant", propertyId: "property", startDate: "2026-01-01", rent: "800", charges: "50", deposit: "800", paymentDay: 5 }, owner.state).value);
  owner.state.transactions.push({ id: "operation", label: "Entretien", date: "2026-01-01", dueDate: "", type: "expense", category: "maintenance", propertyId: "property", amountCents: 10000, status: "pending", counterparty: "", reference: "", notes: "" });
  await save(h, owner);
}
function upload(h, owner, kind, id, { bytes = PDF, name = "document.pdf", type = "autre", origin } = {}) {
  return h.request(`/api/entities/${kind}/${id}/documents`, { cookie: owner.cookie, body: bytes, ...(origin ? { origin } : {}), headers: { "X-File-Name": encodeURIComponent(name), "X-Document-Type": type } });
}

test("les documents fournisseur, locataire et location restent privés et conservent leurs octets", async () => {
  const h = await harness();
  try {
    assert.equal((await h.request("/api/entities/tenant/tenant/documents")).status, 401);
    const owner = await account(h, "docs-owner@example.test");
    const other = await account(h, "docs-other@example.test");
    await fixtures(h, owner); await fixtures(h, other);
    for (const [kind, id, type] of [["supplier", "supplier", "contrat"], ["tenant", "tenant", "garant"], ["lease", "lease", "bail"]]) {
      const added = await upload(h, owner, kind, id, { type, name: "pièce.pdf" });
      assert.equal(added.status, 201, JSON.stringify(added.data));
      const document = added.data.document;
      assert.equal(document.documentType, type);
      assert.equal(document.originalName, "pièce.pdf");
      assert.ok(document.name.endsWith(".pdf"));
      assert.equal(document.size, PDF.length);
      const list = await h.request(`/api/entities/${kind}/${id}/documents`, { cookie: owner.cookie });
      assert.equal(list.data.documents.length, 1);
      assert.equal(list.headers.get("cache-control"), "no-store");
      assert.deepEqual((await h.request(`/api/entities/${kind}/${id}/documents`, { cookie: other.cookie })).data.documents, []);
      for (const method of ["GET", "DELETE"])
        assert.equal((await h.request(`/api/entity-documents/${document.id}`, { cookie: other.cookie, method })).status, 404);
      const downloaded = await h.request(`/api/entity-documents/${document.id}`, { cookie: owner.cookie });
      assert.equal(downloaded.status, 200);
      assert.deepEqual(downloaded.bytes, PDF);
      assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
      assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await h.request(`/api/entity-documents/${document.id}`, { cookie: owner.cookie, method: "DELETE" })).status, 200);
      assert.equal((await h.request(`/api/entity-documents/${document.id}`, { cookie: owner.cookie })).status, 404);
    }
  } finally { await h.close(); }
});

test("les fichiers invalides, types incompatibles, fiches absentes et origines étrangères sont refusés", async () => {
  const h = await harness();
  try {
    const owner = await account(h, "docs-validation@example.test"); await fixtures(h, owner);
    assert.equal((await upload(h, owner, "tenant", "tenant", { type: "bail" })).status, 400);
    assert.equal((await upload(h, owner, "lease", "lease", { bytes: Buffer.from("<html>invalid</html>") })).status, 415);
    assert.equal((await upload(h, owner, "lease", "lease", { name: "wrong.png" })).status, 415);
    assert.equal((await upload(h, owner, "lease", "lease", { name: "../bail.pdf" })).status, 400);
    assert.equal((await upload(h, owner, "lease", "missing")).status, 404);
    assert.equal((await upload(h, owner, "constructor", "lease")).status, 404);
    assert.equal((await upload(h, owner, "lease", "lease", { origin: "https://foreign.example" })).status, 403);
    assert.equal((await upload(h, owner, "lease", "lease", { bytes: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413);
    assert.deepEqual((await h.request("/api/entities/lease/lease/documents", { cookie: owner.cookie })).data.documents, []);
  } finally { await h.close(); }
});

test("les noms ne se remplacent pas et une fiche retirée rend ses documents inaccessibles", async () => {
  const h = await harness();
  try {
    const owner = await account(h, "docs-history@example.test"); await fixtures(h, owner);
    const a = (await upload(h, owner, "lease", "lease", { type: "bail" })).data.document;
    const b = (await upload(h, owner, "lease", "lease", { type: "bail" })).data.document;
    assert.notEqual(a.name, b.name);
    await h.request(`/api/entity-documents/${a.id}`, { cookie: owner.cookie, method: "DELETE" });
    const c = (await upload(h, owner, "lease", "lease", { type: "bail" })).data.document;
    assert.notEqual(b.name, c.name);
    const lease = owner.state.leases.pop(); await save(h, owner);
    assert.equal((await h.request(`/api/entity-documents/${b.id}`, { cookie: owner.cookie })).status, 404);
    assert.equal((await h.request(`/api/entity-documents/${b.id}`, { cookie: owner.cookie, method: "DELETE" })).status, 404);
    owner.state.leases.push(lease); await save(h, owner);
    assert.deepEqual((await h.request(`/api/entity-documents/${b.id}`, { cookie: owner.cookie })).bytes, PDF);
  } finally { await h.close(); }
});

test("les plafonds par fiche et le quota partagé avec les opérations sont respectés", async () => {
  const h = await harness();
  try {
    const owner = await account(h, "docs-limits@example.test"); await fixtures(h, owner);
    for (let i = 0; i < 20; i++) assert.equal((await upload(h, owner, "tenant", "tenant")).status, 201);
    assert.equal((await upload(h, owner, "tenant", "tenant")).status, 409);
    const db = new DatabaseSync(h.dbPath);
    try {
      db.prepare("DELETE FROM entity_documents WHERE user_id=?").run(owner.user.id);
      const maximum = 5 * 1024 * 1024;
      for (let i = 0; i < 9; i++) db.prepare("INSERT INTO attachments(id,user_id,transaction_id,name,original_name,mime,size_bytes,created_at,data) VALUES(?,?,?,?,?,?,?,?,zeroblob(?))")
        .run(`filler-${i}`, owner.user.id, "operation", `file-${i}.pdf`, `file-${i}.pdf`, "application/pdf", maximum, "2026-01-01", maximum);
      db.prepare("INSERT INTO entity_documents(id,user_id,kind,entity_id,document_type,name,original_name,mime,size_bytes,created_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,zeroblob(?))")
        .run("filler-entity", owner.user.id, "lease", "lease", "bail", "Bail.pdf", "Bail.pdf", "application/pdf", maximum, "2026-01-01", maximum);
      assert.equal((await upload(h, owner, "lease", "lease")).status, 409);
      assert.equal((await h.request("/api/transactions/operation/attachments", { cookie: owner.cookie, body: PDF, headers: { "X-File-Name": "facture.pdf" } })).status, 409);
      await h.request("/api/entity-documents/filler-entity", { cookie: owner.cookie, method: "DELETE" });
      assert.equal((await upload(h, owner, "lease", "lease")).status, 201);
    } finally { db.close(); }
  } finally { await h.close(); }
});
