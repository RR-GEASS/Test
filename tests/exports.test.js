import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { inflateRawSync } from "node:zlib";
import { createApp } from "../server/app.js";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
const password = "accountant-export-password-2026";
const dates = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  dateBasis: "payments",
  includeDocuments: true,
};
async function harness() {
  const { app, close } = createApp({ dbPath: ":memory:", production: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async request(
      path,
      {
        body,
        cookie = "",
        method = body ? "POST" : "GET",
        origin = base,
        headers = {},
      } = {},
    ) {
      const binary = Buffer.isBuffer(body);
      const response = await fetch(base + path, {
        method,
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
      await new Promise((r) => server.close(r));
      close();
    },
  };
}
async function account(h, email = "owner@example.test") {
  const r = await h.request("/api/register", {
    body: { email, password, name: "SCI dossiers comptables" },
  });
  assert.equal(r.status, 201);
  return { ...r.data, cookie: r.cookie };
}
async function save(h, owner) {
  const r = await h.request("/api/state", {
    method: "PUT",
    cookie: owner.cookie,
    body: {
      state: owner.state,
      revision: owner.revision,
      accountId: owner.user.id,
    },
  });
  assert.equal(r.status, 200);
  owner.revision = r.data.revision;
  owner.state = r.data.state;
}
async function populate(h, owner) {
  owner.state.properties = [
    {
      id: "property-1",
      name: "République T2",
      address: "12 rue des Tests",
      tenant: "Camille Test",
      rentCents: 80000,
      chargesCents: 5000,
      archived: false,
    },
  ];
  const base = {
    type: "income",
    category: "rent",
    propertyId: "property-1",
    date: "2025-12-05",
    dueDate: "2025-12-05",
    period: "2025-12",
    label: "Loyer et provisions décembre",
    detail: "",
    normalizedLabel: true,
    amountCents: 85000,
    rentCents: 80000,
    chargesCents: 5000,
    counterparty: "Camille Test",
    reference: "FAC-001",
    notes: "Conserver toute cette note",
    status: "paid",
    payments: [
      {
        id: "p-dec",
        date: "2025-12-15",
        amountCents: 42500,
        rentCents: 40000,
        chargesCents: 2500,
      },
      {
        id: "p-jan",
        date: "2026-01-15",
        amountCents: 42500,
        rentCents: 40000,
        chargesCents: 2500,
      },
    ],
  };
  owner.state.transactions = [
    { ...base, id: "rent-1" },
    {
      ...base,
      id: "insurance-1",
      date: "2026-01-20",
      dueDate: "2026-01-20",
      period: "2026-01",
      type: "expense",
      category: "insurance",
      label: "Assurance",
      amountCents: 4200,
      rentCents: 0,
      chargesCents: 0,
      payments: [
        {
          id: "p-insurance",
          date: "2026-01-20",
          amountCents: 4200,
          rentCents: 0,
          chargesCents: 0,
        },
      ],
    },
    {
      ...base,
      id: "outside-1",
      date: "2026-03-15",
      dueDate: "2026-03-15",
      period: "2026-03",
      label: "Hors période",
      normalizedLabel: false,
      payments: [
        {
          id: "p-outside",
          date: "2026-03-15",
          amountCents: 85000,
          rentCents: 80000,
          chargesCents: 5000,
        },
      ],
    },
    {
      ...base,
      id: "pending-1",
      date: "2026-01-05",
      dueDate: "2026-01-05",
      period: "2026-01",
      label: "En attente",
      status: "pending",
      payments: [],
    },
  ];
  await save(h, owner);
}
async function upload(
  h,
  owner,
  transaction = "rent-1",
  name = "facture d’origine.pdf",
) {
  const r = await h.request(`/api/transactions/${transaction}/attachments`, {
    cookie: owner.cookie,
    body: PDF,
    headers: { "X-File-Name": encodeURIComponent(name) },
  });
  assert.equal(r.status, 201);
  return r.data.attachment;
}
// Read our produced ZIP through its central directory, including data descriptors.
function zipFiles(bytes) {
  let end = -1;
  for (
    let pos = bytes.length - 22;
    pos >= Math.max(0, bytes.length - 65557);
    pos--
  ) {
    if (bytes.readUInt32LE(pos) === 0x06054b50) {
      end = pos;
      break;
    }
  }
  assert.ok(end >= 0, "ZIP end record present");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const length = bytes.readUInt16LE(cursor + 28);
    const extra = bytes.readUInt16LE(cursor + 30);
    const comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + length)
      .toString("utf8");
    assert.ok(
      !name.startsWith("/") && !name.includes("..") && !name.includes("\\"),
      "safe ZIP member path",
    );
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const offset =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(offset, offset + compressed);
    const content =
      method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    assert.ok(content);
    assert.equal(content.length, size);
    assert.equal(files.has(name), false);
    files.set(name, content);
    cursor += 46 + length + extra + comment;
  }
  return files;
}

test("le ZIP comptable contient les opérations, règlements de la plage et justificatifs exacts", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    const attachment = await upload(h, owner);
    await upload(h, owner, "outside-1", "hors plage.pdf");
    const r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: dates,
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /application\/zip/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(
      r.headers.get("content-disposition"),
      /cap-sci-comptable-2026-01-01-2026-01-31\.zip/,
    );
    const files = zipFiles(r.bytes);
    for (const name of [
      "operations.csv",
      "reglements.csv",
      "biens.csv",
      "parametres-sci.json",
      "manifest.json",
      "selection.json",
      "README.txt",
    ])
      assert.ok(files.has(name), name);
    const manifest = JSON.parse(files.get("manifest.json"));
    assert.equal(manifest.sourceRevision, owner.revision);
    assert.equal(manifest.summary.operationCount, 2);
    assert.equal(manifest.summary.paymentCount, 2);
    assert.equal(manifest.summary.periodIncomeCents, 42500);
    assert.equal(manifest.summary.periodExpenseCents, 4200);
    assert.equal(manifest.summary.documentCount, 1);
    assert.equal(manifest.summary.includedDocumentCount, 1);
    assert.equal(manifest.documents[0].id, attachment.id);
    assert.equal(manifest.documents[0].originalName, "facture d’origine.pdf");
    assert.deepEqual(files.get(manifest.documents[0].path), PDF);
    assert.ok(manifest.documents[0].name.startsWith("Encaissement"));
    const payments = files.get("reglements.csv").toString();
    assert.ok(payments.includes("2026-01-15"));
    assert.ok(!payments.includes("2025-12-15"));
    assert.ok(!files.get("operations.csv").toString().includes("outside-1"));
    assert.ok(
      files
        .get("operations.csv")
        .toString()
        .includes("Conserver toute cette note"),
    );
    assert.ok(files.get("biens.csv").toString().includes("12 rue des Tests"));
    const selected = JSON.parse(files.get("selection.json"));
    assert.equal(selected.format, "cap-sci-accountant-selection");
    assert.equal(JSON.stringify(selected).includes("p-dec"), false);
    assert.equal(selected.operations[0].reglementsExportes.length, 1);
    assert.equal("payments" in selected.operations[0], false);
    assert.equal(selected.operations[0].totalRegleHistoriqueCents, 85000);
    assert.equal("user" in selected, false);
    assert.equal("password_hash" in selected, false);
    assert.equal("sessions" in selected, false);
  } finally {
    await h.close();
  }
});
test("l’export respecte les choix précis et peut exclure les fichiers sans perdre leur inventaire", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    await upload(h, owner);
    const r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: {
        ...dates,
        operationIds: ["rent-1"],
        includeDocuments: false,
        includeFullPaymentHistory: true,
      },
    });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    const manifest = JSON.parse(files.get("manifest.json"));
    assert.equal(manifest.summary.operationCount, 1);
    assert.equal(manifest.summary.paymentCount, 2);
    assert.equal(manifest.summary.periodIncomeCents, 42500);
    assert.equal(manifest.summary.includedDocumentCount, 0);
    assert.equal(
      [...files.keys()].filter((n) => n.startsWith("justifs/")).length,
      0,
    );
    assert.ok(files.get("reglements.csv").toString().includes("2025-12-15"));
    assert.ok(files.get("reglements.csv").toString().includes('"Non"'));
    assert.equal(manifest.documents[0].included, false);
    const selected = JSON.parse(files.get("selection.json"));
    assert.equal(selected.operations[0].reglementsExportes.length, 2);
    assert.equal(
      selected.operations[0].reglementsExportes.some((p) => p.id === "p-dec"),
      true,
    );
  } finally {
    await h.close();
  }
});
test("les documents et critères d’un autre compte ne peuvent pas être exportés", async () => {
  const h = await harness();
  try {
    const owner = await account(h, "first@example.test");
    await populate(h, owner);
    await upload(h, owner);
    const other = await account(h, "second@example.test");
    let r = await h.request("/api/exports/accountant", {
      cookie: other.cookie,
      body: dates,
    });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    const manifest = JSON.parse(files.get("manifest.json"));
    assert.equal(manifest.summary.operationCount, 0);
    assert.equal(manifest.summary.documentCount, 0);
    assert.equal(
      [...files.keys()].filter((n) => n.startsWith("justifs/")).length,
      0,
    );
    r = await h.request("/api/exports/accountant", {
      cookie: other.cookie,
      body: { ...dates, operationIds: ["rent-1"] },
    });
    assert.equal(r.status, 400);
    r = await h.request("/api/exports/accountant", {
      cookie: other.cookie,
      body: { ...dates, propertyIds: ["property-1"] },
    });
    assert.equal(r.status, 400);
  } finally {
    await h.close();
  }
});
test("l’authentification, l’origine et les dates sont vérifiées avant la création du ZIP", async () => {
  const h = await harness();
  try {
    assert.equal(
      (await h.request("/api/exports/accountant", { body: dates })).status,
      401,
    );
    const owner = await account(h);
    assert.equal(
      (
        await h.request("/api/exports/accountant", {
          cookie: owner.cookie,
          origin: "https://other.test",
          body: dates,
        })
      ).status,
      403,
    );
    for (const body of [
      { ...dates, startDate: "2026-02-31" },
      { ...dates, endDate: "2025-12-31" },
      { ...dates, dateBasis: "unknown" },
      { ...dates, statuses: ["unknown"] },
      { ...dates, includeDocuments: "yes" },
    ])
      assert.equal(
        (
          await h.request("/api/exports/accountant", {
            cookie: owner.cookie,
            body,
          })
        ).status,
        400,
      );
  } finally {
    await h.close();
  }
});
test("la sélection par échéance exporte aussi les opérations non réglées et indique les paiements hors plage", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    const r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: {
        startDate: "2025-12-01",
        endDate: "2025-12-31",
        dateBasis: "due",
      },
    });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    const manifest = JSON.parse(files.get("manifest.json"));
    assert.equal(manifest.summary.operationCount, 1);
    assert.equal(manifest.summary.paymentCount, 2);
    assert.equal(manifest.summary.periodIncomeCents, 42500);
    assert.ok(files.get("reglements.csv").toString().includes("2026-01-15"));
    assert.ok(files.get("reglements.csv").toString().includes('"Non"'));
    const pending = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: { ...dates, dateBasis: "due", statuses: ["overdue"] },
    });
    const pendingFiles = zipFiles(pending.bytes);
    const pendingManifest = JSON.parse(pendingFiles.get("manifest.json"));
    assert.equal(pendingManifest.summary.operationCount, 1);
    assert.equal(pendingManifest.summary.paymentCount, 0);
    assert.ok(
      pendingFiles.get("operations.csv").toString().includes("pending-1"),
    );
  } finally {
    await h.close();
  }
});
