import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import {
  installAttachments,
  synchronizeAttachmentNames,
} from "../server/attachments.js";
import { createEmptyState } from "../src/model.js";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCTkAAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1,
  0, 0, 0xff, 0xd9,
]);
const password = "attachment-test-password-2026";

async function harness() {
  const { app, close } = createApp({ dbPath: ":memory:", production: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    async request(
      path,
      { method, body, cookie = "", origin = base, headers = {} } = {},
    ) {
      const binary = Buffer.isBuffer(body);
      const response = await fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body
            ? {
                "Content-Type": binary
                  ? "application/octet-stream"
                  : "application/json",
              }
            : {}),
          ...headers,
        },
        ...(body ? { body: binary ? body : JSON.stringify(body) } : {}),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        headers: response.headers,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        bytes,
        data: response.headers.get("content-type")?.includes("application/json")
          ? JSON.parse(bytes.toString())
          : undefined,
      };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      close();
    },
  };
}

async function account(h, email = "owner@example.test") {
  const response = await h.request("/api/register", {
    body: { email, password, name: "SCI justificatifs" },
  });
  assert.equal(response.status, 201);
  return { cookie: response.cookie, ...response.data };
}
async function save(h, owner) {
  const response = await h.request("/api/state", {
    method: "PUT",
    cookie: owner.cookie,
    body: {
      state: owner.state,
      revision: owner.revision,
      accountId: owner.user.id,
    },
  });
  assert.equal(response.status, 200);
  owner.revision = response.data.revision;
}
async function operation(h, owner, id = "document-operation") {
  const entry = {
    id,
    label: "Entretien à justifier",
    date: "2026-01-01",
    dueDate: "",
    amountCents: 12500,
    type: "expense",
    category: "maintenance",
    propertyId: "",
    status: "paid",
    counterparty: "",
    reference: "",
    notes: "",
  };
  owner.state.transactions.push(entry);
  await save(h, owner);
  return entry;
}
const upload = (h, owner, id, name = "facture.pdf", bytes = PDF, extra = {}) =>
  h.request(`/api/transactions/${id}/attachments`, {
    cookie: owner.cookie,
    body: bytes,
    headers: { "X-File-Name": encodeURIComponent(name), ...extra },
  });

test("un justificatif PDF est listé, téléchargé sans exposition inline et supprimé", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const added = await upload(h, owner, t.id, "Facture chaudière été.pdf");
    assert.equal(added.status, 201);
    const a = added.data.attachment;
    assert.equal(a.name, "Entretien à justifier.pdf");
    assert.equal(a.originalName, "Facture chaudière été.pdf");
    assert.equal(a.mime, "application/pdf");
    assert.equal(a.size, PDF.length);
    assert.ok(a.createdAt);
    assert.ok(a.id);
    const list = await h.request(`/api/transactions/${t.id}/attachments`, {
      cookie: owner.cookie,
    });
    assert.deepEqual(list.data.attachments, [a]);
    assert.equal("data" in a, false);
    const fetched = await h.request(`/api/attachments/${a.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.bytes, PDF);
    assert.equal(fetched.headers.get("content-type"), "application/pdf");
    assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");
    assert.equal(fetched.headers.get("cache-control"), "no-store");
    assert.match(fetched.headers.get("content-disposition"), /^attachment;/);
    assert.ok(
      fetched.headers
        .get("content-disposition")
        .includes("filename*=UTF-8''Entretien%20%C3%A0%20justifier.pdf"),
    );
    const removed = await h.request(`/api/attachments/${a.id}`, {
      cookie: owner.cookie,
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
    assert.equal(
      (await h.request(`/api/attachments/${a.id}`, { cookie: owner.cookie }))
        .status,
      404,
    );
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
        })
      ).data.attachments.length,
      0,
    );
    const state = await h.request("/api/session", { cookie: owner.cookie });
    assert.equal(state.data.state.transactions.length, 1);
  } finally {
    await h.close();
  }
});

test("la lecture, l’envoi et la suppression restent limités au propriétaire connecté", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const added = await upload(h, owner, t.id);
    const id = added.data.attachment.id;
    assert.equal(
      (await h.request(`/api/transactions/${t.id}/attachments`)).status,
      401,
    );
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          body: PDF,
          headers: { "X-File-Name": "facture.pdf" },
        })
      ).status,
      401,
    );
    assert.equal((await h.request(`/api/attachments/${id}`)).status, 401);
    const other = await account(h, "other@example.test");
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: other.cookie,
        })
      ).status,
      404,
    );
    assert.equal((await upload(h, other, t.id)).status, 404);
    assert.equal(
      (await h.request(`/api/attachments/${id}`, { cookie: other.cookie }))
        .status,
      404,
    );
    assert.equal(
      (
        await h.request(`/api/attachments/${id}`, {
          cookie: other.cookie,
          method: "DELETE",
        })
      ).status,
      404,
    );
    await operation(h, other, t.id);
    assert.deepEqual(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: other.cookie,
        })
      ).data.attachments,
      [],
    );
    assert.equal(
      (await h.request(`/api/attachments/${id}`, { cookie: owner.cookie }))
        .status,
      200,
    );
  } finally {
    await h.close();
  }
});

test("les signatures PDF, PNG et JPEG doivent correspondre aux extensions", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    assert.equal((await upload(h, owner, t.id, "scan.PNG", PNG)).status, 201);
    const jpg = await upload(h, owner, t.id, "scan.jpeg", JPEG);
    assert.equal(jpg.status, 201);
    assert.equal(jpg.data.attachment.mime, "image/jpeg");
    for (const [name, bytes] of [
      ["faux.pdf", Buffer.from("<html><script>alert(1)</script></html>")],
      ["document.exe", PDF],
      ["scan.png", PDF],
      [
        "image.svg",
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ],
      ["vide.pdf", Buffer.alloc(0)],
    ])
      assert.equal((await upload(h, owner, t.id, name, bytes)).status, 415);
    for (const name of [
      "../facture.pdf",
      "dossier\\facture.pdf",
      "facture\n.pdf",
      "facture\u202e.pdf",
      "x".repeat(161) + ".pdf",
    ])
      assert.equal((await upload(h, owner, t.id, name)).status, 400);
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
          body: PDF,
          headers: { "X-File-Name": "%zz" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
          body: { file: "fake" },
          headers: { "X-File-Name": "facture.pdf" },
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
        })
      ).data.attachments.length,
      2,
    );
  } finally {
    await h.close();
  }
});

test("un fichier dépassant 5 Mio est refusé sans insertion", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 32);
    PDF.copy(big);
    big.write("%%EOF", big.length - 5);
    assert.equal((await upload(h, owner, t.id, "grand.pdf", big)).status, 413);
    assert.deepEqual(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
        })
      ).data.attachments,
      [],
    );
  } finally {
    await h.close();
  }
});

test("chaque opération accepte au plus vingt justificatifs", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await upload(h, owner, t.id, `facture-${i}.pdf`)).status,
        201,
      );
    const excess = await upload(h, owner, t.id, "derniere.pdf");
    assert.equal(excess.status, 409);
    assert.match(excess.data.error, /20 justificatifs/);
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
        })
      ).data.attachments.length,
      20,
    );
  } finally {
    await h.close();
  }
});

test("le compte ne peut pas dépasser cinquante Mio de justificatifs", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const document = Buffer.alloc(3 * 1024 * 1024, 32);
    PDF.copy(document);
    document.write("%%EOF", document.length - 5);
    for (let i = 0; i < 16; i++)
      assert.equal(
        (await upload(h, owner, t.id, `document-${i}.pdf`, document)).status,
        201,
      );
    const excess = await upload(h, owner, t.id, "trop.pdf", document);
    assert.equal(excess.status, 409);
    assert.match(excess.data.error, /50 Mo/);
  } finally {
    await h.close();
  }
});

test("une opération absente masque ses documents sans les détruire lors d’un import", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const added = await upload(h, owner, t.id);
    const id = added.data.attachment.id;
    owner.state.transactions = [];
    await save(h, owner);
    assert.equal(
      (await h.request(`/api/attachments/${id}`, { cookie: owner.cookie }))
        .status,
      404,
    );
    assert.equal(
      (
        await h.request(`/api/attachments/${id}`, {
          cookie: owner.cookie,
          method: "DELETE",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
        })
      ).status,
      404,
    );
    owner.state.transactions = [t];
    await save(h, owner);
    assert.deepEqual(
      (await h.request(`/api/attachments/${id}`, { cookie: owner.cookie }))
        .bytes,
      PDF,
    );
  } finally {
    await h.close();
  }
});

test("les mutations des documents appliquent aussi les contrôles d’origine", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const added = await upload(h, owner, t.id);
    const id = added.data.attachment.id;
    assert.equal(
      (
        await h.request(`/api/transactions/${t.id}/attachments`, {
          cookie: owner.cookie,
          origin: "https://evil.test",
          body: PDF,
          headers: { "X-File-Name": "facture.pdf" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request(`/api/attachments/${id}`, {
          cookie: owner.cookie,
          origin: "https://evil.test",
          method: "DELETE",
        })
      ).status,
      403,
    );
    assert.equal(
      (await h.request(`/api/attachments/${id}`, { cookie: owner.cookie }))
        .status,
      200,
    );
  } finally {
    await h.close();
  }
});

test("les noms suivent le libellé courant, distinguent les fichiers et conservent les noms originaux", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    const t = await operation(h, owner);
    const first = await upload(h, owner, t.id, "scan_original.PDF");
    const second = await upload(h, owner, t.id, "autre.pdf");
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    let list = (
      await h.request(`/api/transactions/${t.id}/attachments`, {
        cookie: owner.cookie,
      })
    ).data.attachments;
    assert.equal(new Set(list.map((a) => a.name.toLowerCase())).size, 2);
    assert.deepEqual(
      list.map((a) => a.name),
      ["Entretien à justifier.PDF", "Entretien à justifier (2).pdf"],
    );
    assert.deepEqual(
      list.map((a) => a.originalName),
      ["scan_original.PDF", "autre.pdf"],
    );
    t.label = "Décaissement · SCI / Général · Assurances · novembre 2026";
    await save(h, owner);
    const downloaded = await h.request(
      `/api/attachments/${first.data.attachment.id}`,
      { cookie: owner.cookie },
    );
    assert.equal(downloaded.status, 200);
    assert.deepEqual(downloaded.bytes, PDF);
    assert.ok(
      downloaded.headers
        .get("content-disposition")
        .includes("SCI%20-%20G%C3%A9n%C3%A9ral"),
    );
    list = (
      await h.request(`/api/transactions/${t.id}/attachments`, {
        cookie: owner.cookie,
      })
    ).data.attachments;
    assert.equal(
      list[0].name,
      "Décaissement · SCI - Général · Assurances · novembre 2026.PDF",
    );
    assert.equal(
      list[1].name,
      "Décaissement · SCI - Général · Assurances · novembre 2026 (2).pdf",
    );
    assert.equal(list[0].originalName, "scan_original.PDF");
  } finally {
    await h.close();
  }
});

test("la migration de l’ancien schéma et le renommage sont idempotents sans toucher aux fichiers ni aux autres comptes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE attachments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),transaction_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size_bytes INTEGER NOT NULL,created_at TEXT NOT NULL,data BLOB NOT NULL);`);
    const state = createEmptyState();
    state.transactions = [
      {
        id: "t",
        label: "Loyer · Novembre",
        date: "2026-11-01",
        dueDate: "",
        amountCents: 85000,
        type: "income",
        category: "rent",
        propertyId: "",
        status: "pending",
        counterparty: "",
        reference: "",
        notes: "",
      },
    ];
    db.prepare("INSERT INTO users(id,state) VALUES(?,?)").run(
      "owner",
      JSON.stringify(state),
    );
    db.prepare("INSERT INTO users(id,state) VALUES(?,?)").run(
      "other",
      JSON.stringify(state),
    );
    const insert = db.prepare(
      "INSERT INTO attachments(id,user_id,transaction_id,name,mime,size_bytes,created_at,data) VALUES(?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "a",
      "owner",
      "t",
      "ancienne facture.pdf",
      "application/pdf",
      PDF.length,
      "2026-11-01T00:00:00.000Z",
      PDF,
    );
    insert.run(
      "orphan",
      "owner",
      "absent",
      "orphelin.pdf",
      "application/pdf",
      PDF.length,
      "2026-11-01T00:00:00.000Z",
      PDF,
    );
    insert.run(
      "other-a",
      "other",
      "t",
      "autre compte.pdf",
      "application/pdf",
      PDF.length,
      "2026-11-01T00:00:00.000Z",
      PDF,
    );
    installAttachments(express(), db, (_req, _res, next) => next());
    installAttachments(express(), db, (_req, _res, next) => next());
    assert.equal(
      db
        .prepare("PRAGMA table_info(attachments)")
        .all()
        .filter((c) => c.name === "original_name").length,
      1,
    );
    synchronizeAttachmentNames(db, "owner");
    assert.equal(synchronizeAttachmentNames(db, "owner"), 0);
    const a = db.prepare("SELECT * FROM attachments WHERE id=?").get("a");
    assert.equal(a.name, "Loyer · Novembre.pdf");
    assert.equal(a.original_name, "ancienne facture.pdf");
    assert.deepEqual(Buffer.from(a.data), PDF);
    assert.equal(
      db.prepare("SELECT name FROM attachments WHERE id=?").get("orphan").name,
      "orphelin.pdf",
    );
    assert.equal(
      db.prepare("SELECT name FROM attachments WHERE id=?").get("other-a").name,
      "autre compte.pdf",
    );
  } finally {
    db.close();
  }
});
