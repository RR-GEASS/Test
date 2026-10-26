import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
const password = "a-long-test-password-2026";
async function harness(dbPath = ":memory:", production = false) {
  const { app, close } = createApp({ allowTestFixtures: true, dbPath, production });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async request(
      path,
      { body, method = body ? "POST" : "GET", cookie = "", origin = base } = {},
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          Origin: origin,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        cookieHeader: response.headers.get("set-cookie"),
        data: await response.json(),
        headers: response.headers,
      };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      close();
    },
  };
}
async function register(h, email = "owner@example.test") {
  return h.request("/api/register", {
    body: { email, password, name: "SCI Test IS" },
  });
}
test("compte, mot de passe haché, cookie protégé et connexion", async () => {
  const h = await harness();
  try {
    const result = await register(h);
    assert.equal(result.status, 201);
    assert.match(result.cookieHeader, /HttpOnly/i);
    assert.match(result.cookieHeader, /SameSite=Lax/i);
    assert.equal(result.data.state.mode, "real");
    assert.equal(result.data.state.settings.taxRegime, "IS");
    assert.equal(result.data.state.transactions.length, 0);
    assert.equal("password_hash" in result.data.user, false);
    const bad = await h.request("/api/login", {
      body: { email: "owner@example.test", password: "wrong" },
    });
    assert.equal(bad.status, 401);
    const ok = await h.request("/api/login", {
      body: { email: "owner@example.test", password },
    });
    assert.equal(ok.status, 200);
    assert.equal(
      (await h.request("/api/session", { cookie: ok.cookie })).status,
      200,
    );
  } finally {
    await h.close();
  }
});
test("les données de deux comptes restent séparées et un accès anonyme est refusé", async () => {
  const h = await harness();
  try {
    assert.equal((await h.request("/api/session")).status, 401);
    const a = await register(h, "a@example.test");
    const b = await register(h, "b@example.test");
    a.data.state.settings.name = "SCI privée A";
    assert.equal(
      (
        await h.request("/api/test-fixtures/state", {
          method: "PUT",
          cookie: a.cookie,
          body: { state: a.data.state, revision: 0, accountId: a.data.user.id },
        })
      ).status,
      200,
    );
    const other = await h.request("/api/session", { cookie: b.cookie });
    assert.equal(other.data.state.settings.name, "SCI Test IS");
    assert.equal(
      (
        await h.request("/api/test-fixtures/state", {
          method: "PUT",
          body: { state: a.data.state, revision: 0, accountId: a.data.user.id },
        })
      ).status,
      401,
    );
  } finally {
    await h.close();
  }
});
test("les écritures d’un autre site sont bloquées et une version périmée ne remplace rien", async () => {
  const h = await harness();
  try {
    const a = await register(h);
    const body = {
      state: a.data.state,
      revision: 0,
      accountId: a.data.user.id,
    };
    assert.equal(
      (
        await h.request("/api/test-fixtures/state", {
          method: "PUT",
          body,
          cookie: a.cookie,
          origin: "https://other.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (await h.request("/api/test-fixtures/state", { method: "PUT", body, cookie: a.cookie }))
        .status,
      200,
    );
    const conflict = await h.request("/api/test-fixtures/state", {
      method: "PUT",
      body,
      cookie: a.cookie,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.code, "conflict");
    assert.equal(
      (await h.request("/api/session", { cookie: a.cookie })).data.revision,
      1,
    );
  } finally {
    await h.close();
  }
});
test("les sauvegardes financières invalides et les doublons de comptes sont refusés", async () => {
  const h = await harness();
  try {
    const a = await register(h);
    const bad = structuredClone(a.data.state);
    bad.settings.openingBalanceCents = 0.123;
    assert.equal(
      (
        await h.request("/api/test-fixtures/state", {
          method: "PUT",
          cookie: a.cookie,
          body: { state: bad, revision: 0, accountId: a.data.user.id },
        })
      ).status,
      400,
    );
    assert.equal((await register(h)).status, 409);
    assert.equal(
      (
        await h.request("/api/register", {
          body: { email: "x@example.test", password: "short", name: "SCI" },
        })
      ).status,
      400,
    );
  } finally {
    await h.close();
  }
});
test("la déconnexion invalide le cookie côté serveur", async () => {
  const h = await harness();
  try {
    const a = await register(h);
    assert.equal(
      (await h.request("/api/logout", { cookie: a.cookie, body: {} })).status,
      200,
    );
    assert.equal(
      (await h.request("/api/session", { cookie: a.cookie })).status,
      401,
    );
  } finally {
    await h.close();
  }
});
test("les données et les sessions sont conservées après redémarrage SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atelier-sci-"));
  let h;
  try {
    h = await harness(join(dir, "test.sqlite"));
    const a = await register(h);
    a.data.state.settings.name = "SCI persistante";
    await h.request("/api/test-fixtures/state", {
      cookie: a.cookie,
      method: "PUT",
      body: { state: a.data.state, revision: 0, accountId: a.data.user.id },
    });
    await h.close();
    h = await harness(join(dir, "test.sqlite"));
    const r = await h.request("/api/session", { cookie: a.cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.state.settings.name, "SCI persistante");
    assert.equal(r.data.revision, 1);
  } finally {
    if (h) await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("les cookies de production imposent HTTPS et les API ne sont pas mises en cache", async () => {
  const h = await harness(":memory:", true);
  try {
    const a = await register(h);
    assert.match(a.cookieHeader, /Secure/i);
    assert.equal(a.headers.get("cache-control"), "no-store");
    assert.ok(
      a.headers
        .get("content-security-policy")
        .includes("frame-ancestors 'none'"),
    );
  } finally {
    await h.close();
  }
});
test("un ancien onglet ne peut pas enregistrer sa SCI dans un compte différent", async () => {
  const h = await harness();
  try {
    const a = await register(h, "first@example.test");
    const b = await register(h, "second@example.test");
    const result = await h.request("/api/test-fixtures/state", {
      method: "PUT",
      cookie: b.cookie,
      body: { state: a.data.state, revision: 0, accountId: a.data.user.id },
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, "account_changed");
    assert.equal(
      (await h.request("/api/session", { cookie: b.cookie })).data.revision,
      0,
    );
  } finally {
    await h.close();
  }
});
test("les échéances générées côté serveur persistent sans doublon ni réapparition après suppression", async () => {
  const h = await harness();
  try {
    const a = await register(h);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
    a.data.state.recurrences = [
      {
        id: "rec-api",
        type: "expense",
        category: "insurance",
        propertyId: "",
        amountCents: 4200,
        rentCents: 0,
        chargesCents: 0,
        counterparty: "Assureur",
        detail: "Assurance mensuelle",
        frequency: "monthly",
        startDate,
        endDate: "",
        active: true,
        generatedThrough: "",
      },
    ];
    const saved = await h.request("/api/test-fixtures/state", {
      method: "PUT",
      cookie: a.cookie,
      body: { accountId: a.data.user.id, state: a.data.state, revision: 0 },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.state.transactions.length, 2);
    assert.ok(
      saved.data.state.transactions.every((t) => t.status === "pending"),
    );
    const loaded = await h.request("/api/session", { cookie: a.cookie });
    assert.equal(loaded.data.revision, saved.data.revision);
    assert.deepEqual(
      loaded.data.state.transactions.map((t) => t.id),
      saved.data.state.transactions.map((t) => t.id),
    );
    loaded.data.state.transactions.shift();
    const deleted = await h.request("/api/test-fixtures/state", {
      method: "PUT",
      cookie: a.cookie,
      body: {
        accountId: a.data.user.id,
        state: loaded.data.state,
        revision: loaded.data.revision,
      },
    });
    assert.equal(deleted.status, 200);
    assert.equal(
      (await h.request("/api/session", { cookie: a.cookie })).data.state
        .transactions.length,
      1,
    );
  } finally {
    await h.close();
  }
});
test("une erreur de renommage ne valide pas partiellement la modification d’une opération", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capsci-atomic-"));
  const path = join(dir, "db.sqlite");
  const h = await harness(path);
  let db;
  try {
    const a = await register(h);
    a.data.state.transactions = [
      {
        id: "atomic-operation",
        date: "2026-01-01",
        dueDate: "",
        type: "income",
        status: "pending",
        label: "Avant modification",
        category: "other_income",
        propertyId: "",
        amountCents: 12345,
        counterparty: "",
        reference: "",
        notes: "",
      },
    ];
    const saved = await h.request("/api/test-fixtures/state", {
      method: "PUT",
      cookie: a.cookie,
      body: { accountId: a.data.user.id, revision: 0, state: a.data.state },
    });
    assert.equal(saved.status, 200);
    const uploaded = await fetch(
      h.base + "/api/transactions/atomic-operation/attachments",
      {
        method: "POST",
        headers: {
          Origin: h.base,
          Cookie: a.cookie,
          "Content-Type": "application/octet-stream",
          "X-File-Name": "original.pdf",
        },
        body: Buffer.from("%PDF-1.4\nminimal\n%%EOF"),
      },
    );
    assert.equal(uploaded.status, 201);
    db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER reject_rename BEFORE UPDATE OF name ON attachments WHEN NEW.name<>OLD.name BEGIN SELECT RAISE(ABORT,'simulated rename failure'); END;",
    );
    saved.data.state.transactions[0].label = "Après modification";
    const failed = await h.request("/api/test-fixtures/state", {
      method: "PUT",
      cookie: a.cookie,
      body: {
        accountId: a.data.user.id,
        revision: saved.data.revision,
        state: saved.data.state,
      },
    });
    assert.equal(failed.status, 500);
    const actual = await h.request("/api/session", { cookie: a.cookie });
    assert.equal(actual.data.revision, saved.data.revision);
    assert.equal(actual.data.state.transactions[0].label, "Avant modification");
    assert.equal(
      db.prepare("SELECT name FROM attachments").get().name,
      "Avant modification.pdf",
    );
  } finally {
    db?.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test("une location enregistrée ne peut pas être réattribuée par une écriture ou un import", async () => {
  const h = await harness();
  try {
    const account = await register(h);
    const { user, state } = account.data;
    const cookie = account.cookie;
    state.properties.push({id:"p1",name:"Bien",address:"",tenant:"",rentCents:0,chargesCents:0,archived:false});
    state.tenants.push(...["t1","t2"].map(id => ({id,name:id,email:"",phone:"",address:"",notes:"",archived:false})));
    state.leases.push({id:"l1",tenantId:"t1",propertyId:"p1",startDate:"2026-01-01",endDate:"",rentCents:50000,chargesCents:0,depositCents:50000,paymentDay:1,notes:""});
    const saved = await h.request("/api/test-fixtures/state",{cookie,method:"PUT",body:{state,revision:account.data.revision,accountId:user.id}});
    assert.equal(saved.status,200);
    const changed = structuredClone(saved.data.state);
    changed.leases[0].tenantId = "t2";
    const denied = await h.request("/api/test-fixtures/state",{cookie,method:"PUT",body:{state:changed,revision:saved.data.revision,accountId:user.id}});
    assert.equal(denied.status,409);
    assert.equal(denied.data.code,"lease_identity_changed");
    const current = await h.request("/api/session",{cookie});
    assert.equal(current.data.state.leases[0].tenantId,"t1");
    assert.equal(current.data.revision,saved.data.revision);
  } finally { await h.close(); }
});
