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
  const { app, close } = createApp({ allowTestFixtures: true, dbPath: ":memory:", production: false });
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
  const r = await h.request("/api/test-fixtures/state", {
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

const csvNames = ["operations.csv", "reglements.csv", "biens.csv"];
function assertSimpleArchive(files) {
  for (const name of csvNames) assert.ok(files.has(name), name);
  for (const name of files.keys()) {
    assert.equal(/\.json$/i.test(name), false, "no JSON in accountant archive");
    assert.equal(
      /(?:^|\/)readme(?:\.|$)/i.test(name),
      false,
      "no README in accountant archive",
    );
    assert.equal(
      name.startsWith("justifs/"),
      false,
      "no technical wrapper directory",
    );
    if (name.includes("/")) {
      const parts = name.split("/");
      assert.equal(
        parts.length,
        3,
        "exactly property/type/file, or property/type/ directory entry",
      );
      assert.ok(["Encaissements", "Décaissements"].includes(parts[1]));
      if (!name.endsWith("/"))
        assert.ok(name.length <= 190, "Windows-friendly relative path");
    } else
      assert.ok(
        csvNames.includes(name),
        "only accounting CSVs at archive root",
      );
  }
}
function csvRows(buffer) {
  const text = buffer.toString("utf8").replace(/^\ufeff/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ";" && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] || ""]),
    ),
  );
}
const documentEntries = (files) =>
  [...files.entries()].filter(
    ([name]) => name.includes("/") && !name.endsWith("/"),
  );

test("le ZIP classe les justificatifs par bien et direction, sans JSON ni README", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    await upload(h, owner);
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
    assertSimpleArchive(files);
    assert.ok(files.has("République T2/Encaissements/"));
    assert.ok(files.has("République T2/Décaissements/"));
    const docs = documentEntries(files);
    assert.equal(docs.length, 1);
    assert.ok(
      docs[0][0].startsWith("République T2/Encaissements/Encaissement"),
    );
    assert.deepEqual(docs[0][1], PDF);
    const operations = csvRows(files.get("operations.csv"));
    assert.equal(operations.length, 2);
    const rent = operations.find((t) => t["ID opération"] === "rent-1");
    assert.equal(rent["Encaissements dans la plage EUR"], "425,00");
    assert.equal(rent["Total réglé historique EUR"], "850,00");
    assert.equal(rent["Notes"], "Conserver toute cette note");
    assert.equal(rent["Justificatifs inclus"], docs[0][0]);
    assert.equal(rent["Nombre de justificatifs enregistrés"], "1");
    assert.equal(rent["Justificatif manquant"], "Non");
    const insurance = operations.find((t) => t["ID opération"] === "insurance-1");
    assert.equal(insurance["Nombre de justificatifs enregistrés"], "0");
    assert.equal(insurance["Justificatif manquant"], "Oui");
    assert.equal(
      operations.some((t) => t["ID opération"] === "outside-1"),
      false,
    );
    assert.ok(files.get("biens.csv").toString().includes("12 rue des Tests"));
    const payments = csvRows(files.get("reglements.csv"));
    assert.equal(payments.length, 2);
    assert.ok(payments.some((p) => p["ID règlement"] === "p-jan"));
    assert.ok(!payments.some((p) => p["ID règlement"] === "p-dec"));
  } finally {
    await h.close();
  }
});

test("les critères précis peuvent exclure tous les fichiers et conserver uniquement les trois CSV", async () => {
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
    assertSimpleArchive(files);
    assert.deepEqual([...files.keys()].sort(), [...csvNames].sort());
    const operations = csvRows(files.get("operations.csv"));
    assert.equal(operations.length, 1);
    assert.equal(operations[0]["ID opération"], "rent-1");
    assert.equal(operations[0]["Justificatifs inclus"], "");
    assert.equal(operations[0]["Nombre de justificatifs enregistrés"], "1");
    assert.equal(operations[0]["Justificatif manquant"], "Non");
    const payments = csvRows(files.get("reglements.csv"));
    assert.equal(payments.length, 2);
    assert.equal(
      payments.find((p) => p["ID règlement"] === "p-dec")[
        "Dans la plage de dates"
      ],
      "Non",
    );
    assert.equal(
      payments.find((p) => p["ID règlement"] === "p-jan")[
        "Dans la plage de dates"
      ],
      "Oui",
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
    assertSimpleArchive(files);
    assert.deepEqual([...files.keys()].sort(), [...csvNames].sort());
    assert.equal(csvRows(files.get("operations.csv")).length, 0);
    assert.equal(csvRows(files.get("reglements.csv")).length, 0);
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

test("les échéances non réglées et les paiements hors plage restent distingués dans les CSV", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    let r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: {
        startDate: "2025-12-01",
        endDate: "2025-12-31",
        dateBasis: "due",
      },
    });
    assert.equal(r.status, 200);
    let files = zipFiles(r.bytes);
    assertSimpleArchive(files);
    assert.equal(csvRows(files.get("operations.csv")).length, 1);
    let payments = csvRows(files.get("reglements.csv"));
    assert.equal(payments.length, 2);
    assert.equal(
      payments.find((p) => p["ID règlement"] === "p-jan")[
        "Dans la plage de dates"
      ],
      "Non",
    );
    r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: { ...dates, dateBasis: "due", statuses: ["overdue"] },
    });
    assert.equal(r.status, 200);
    files = zipFiles(r.bytes);
    assertSimpleArchive(files);
    assert.equal(csvRows(files.get("operations.csv")).length, 1);
    assert.equal(
      csvRows(files.get("operations.csv"))[0]["ID opération"],
      "pending-1",
    );
    assert.equal(csvRows(files.get("reglements.csv")).length, 0);
  } finally {
    await h.close();
  }
});

test("les biens et opérations générales ont chacun exactement deux dossiers de direction", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    owner.state.properties.push({
      ...owner.state.properties[0],
      id: "property-2",
      name: "Tilleuls Studio",
    });
    owner.state.transactions.push({
      ...owner.state.transactions[1],
      id: "second-property",
      propertyId: "property-2",
      payments: owner.state.transactions[1].payments.map((p) => ({
        ...p,
        id: "p-second",
      })),
    });
    owner.state.transactions.push({
      ...owner.state.transactions[1],
      id: "general-operation",
      propertyId: "",
      payments: owner.state.transactions[1].payments.map((p) => ({
        ...p,
        id: "p-general",
      })),
    });
    await save(h, owner);
    for (const id of [
      "rent-1",
      "insurance-1",
      "second-property",
      "general-operation",
    ])
      await upload(h, owner, id, `${id}.PDF`);
    const r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: dates,
    });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    assertSimpleArchive(files);
    for (const property of [
      "République T2",
      "Tilleuls Studio",
      "SCI - Général",
    ])
      for (const direction of ["Encaissements", "Décaissements"])
        assert.ok(files.has(`${property}/${direction}/`));
    const docs = documentEntries(files);
    assert.equal(docs.length, 4);
    assert.equal(
      docs.filter(([name]) => name.startsWith("République T2/Encaissements/"))
        .length,
      1,
    );
    assert.equal(
      docs.filter(([name]) => name.startsWith("République T2/Décaissements/"))
        .length,
      1,
    );
    assert.equal(
      docs.filter(([name]) => name.startsWith("Tilleuls Studio/Décaissements/"))
        .length,
      1,
    );
    assert.equal(
      docs.filter(([name]) => name.startsWith("SCI - Général/Décaissements/"))
        .length,
      1,
    );
    for (const [, data] of docs) assert.deepEqual(data, PDF);
    const referenced = csvRows(files.get("operations.csv")).flatMap((row) =>
      row["Justificatifs inclus"].split("\n").filter(Boolean),
    );
    assert.equal(referenced.length, 4);
    for (const path of referenced) assert.ok(files.has(path));
  } finally {
    await h.close();
  }
});

test("deux opérations homonymes du même bien ne peuvent pas écraser leurs justificatifs", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    const original = owner.state.transactions[1];
    original.normalizedLabel = false;
    original.label = "Même facture";
    owner.state.transactions.push({
      ...original,
      id: "same-label",
      payments: original.payments.map((p) => ({ ...p, id: "p-same" })),
    });
    await save(h, owner);
    await upload(h, owner, "insurance-1", "first.pdf");
    await upload(h, owner, "same-label", "second.pdf");
    const r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: { ...dates, types: ["expense"] },
    });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    assertSimpleArchive(files);
    const docs = documentEntries(files);
    assert.equal(docs.length, 2);
    assert.ok(files.has("République T2/Décaissements/Même facture.pdf"));
    assert.ok(files.has("République T2/Décaissements/Même facture (2).pdf"));
    for (const [, data] of docs) assert.deepEqual(data, PDF);
    const paths = csvRows(files.get("operations.csv")).map(
      (t) => t["Justificatifs inclus"],
    );
    assert.equal(new Set(paths).size, 2);
    for (const path of paths) assert.ok(files.has(path));
  } finally {
    await h.close();
  }
});

test("les noms de biens dangereux ou confondus sont désambiguïsés de façon stable", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    const names = ["A/B", "A:B", "a - b", "SCI - Général", "../CON"];
    owner.state.properties = names.map((name, i) => ({
      ...owner.state.properties[0],
      id: `safe-property-${i}`,
      name,
    }));
    const template = owner.state.transactions[1];
    owner.state.transactions = owner.state.properties.map((p, i) => ({
      ...template,
      id: `safe-operation-${i}`,
      propertyId: p.id,
      normalizedLabel: false,
      label: "Un même document " + "très long ".repeat(30),
      payments: template.payments.map((payment) => ({
        ...payment,
        id: `safe-payment-${i}`,
      })),
    }));
    // Plain legacy labels are limited to160 characters; keep this test valid while filling the path budget.
    owner.state.transactions.forEach((t) => (t.label = t.label.slice(0, 150)));
    owner.state.transactions.push({
      ...owner.state.transactions[0],
      id: "safe-general",
      propertyId: "",
      payments: template.payments.map((payment) => ({
        ...payment,
        id: "safe-general-payment",
      })),
    });
    await save(h, owner);
    for (const t of owner.state.transactions)
      await upload(h, owner, t.id, "original.pdf");
    const all = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: dates,
    });
    assert.equal(all.status, 200);
    const files = zipFiles(all.bytes);
    assertSimpleArchive(files);
    const docs = documentEntries(files);
    assert.equal(docs.length, 6);
    const parents = docs.map(([name]) => name.split("/")[0]);
    assert.equal(
      new Set(parents.map((name) => name.toLocaleLowerCase("fr"))).size,
      6,
    );
    assert.ok(parents.includes("SCI - Général"));
    assert.ok(parents.includes("SCI - Général (2)"));
    assert.ok(
      parents.every(
        (name) => !/[<>:"\\|?*]/.test(name) && !/^CON$/i.test(name),
      ),
    );
    const rows = csvRows(files.get("operations.csv"));
    for (const row of rows) assert.ok(files.has(row["Justificatifs inclus"]));
    const oneId = "safe-operation-1";
    const expected = rows.find((row) => row["ID opération"] === oneId)[
      "Justificatifs inclus"
    ];
    const single = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: { ...dates, operationIds: [oneId] },
    });
    assert.equal(single.status, 200);
    const selected = zipFiles(single.bytes);
    assertSimpleArchive(selected);
    assert.ok(
      selected.has(expected),
      "property folder remains stable after filtering out colliding properties",
    );
  } finally {
    await h.close();
  }
});

test("la ventilation attendue d’un prêt partiellement réglé et ses renseignements sont exportés sans inventer de règlement", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    owner.state.transactions.push({
      ...owner.state.transactions[1],
      id: "loan-1",
      category: "loan_payment",
      amountCents: 100000,
      capitalCents: 75000,
      interestCents: 22000,
      insuranceCents: 3000,
      counterparty: "Banque du bien",
      reference: "PRET-2026-01",
      notes: "Vérifier le tableau d’amortissement",
      payments: [{ id: "loan-partial", date: "2026-01-20", amountCents: 40000, rentCents: 0, chargesCents: 0 }],
    });
    await save(h, owner);
    await upload(h, owner, "loan-1", "tableau-banque.pdf");
    const r = await h.request("/api/exports/accountant", {
      cookie: owner.cookie,
      body: { ...dates, operationIds: ["loan-1"], includeDocuments: false },
    });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    assertSimpleArchive(files);
    assert.deepEqual([...files.keys()].sort(), [...csvNames].sort());
    const operations = csvRows(files.get("operations.csv"));
    assert.equal(operations.length, 1);
    const loan = operations[0];
    assert.equal(loan["Montant attendu EUR"], "1000,00");
    assert.equal(loan["Capital de prêt attendu EUR"], "750,00");
    assert.equal(loan["Intérêts de prêt attendus EUR"], "220,00");
    assert.equal(loan["Assurance emprunteur attendue EUR"], "30,00");
    assert.equal(loan["Total réglé historique EUR"], "400,00");
    assert.equal(loan["Reste à régler EUR"], "600,00");
    assert.equal(loan["Décaissements dans la plage EUR"], "400,00");
    assert.equal(loan["Tiers"], "Banque du bien");
    assert.equal(loan["Référence de pièce"], "PRET-2026-01");
    assert.equal(loan["Notes"], "Vérifier le tableau d’amortissement");
    assert.equal(loan["Nombre de justificatifs enregistrés"], "1");
    assert.equal(loan["Justificatif manquant"], "Non");
    assert.equal(loan["Justificatifs inclus"], "");
    const payments = csvRows(files.get("reglements.csv"));
    assert.equal(payments.length, 1);
    assert.equal(payments[0]["ID règlement"], "loan-partial");
    assert.equal(payments[0]["Montant réglé EUR"], "400,00");
  } finally {
    await h.close();
  }
});

test("les baux et avenants liés sont ajoutés uniquement sur demande, sans document personnel ni pièce d’une autre location", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    owner.state.tenants = [{ id: "tenant-1", name: "Camille Test", archived: false }];
    owner.state.leases = [{ id: "lease-1", tenantId: "tenant-1", propertyId: "property-1", startDate: "2025-01-01", endDate: "2026-01-31", rentCents: 80000, chargesCents: 5000, depositCents: 80000, paymentDay: 5 }];
    owner.state.leases.push({ ...owner.state.leases[0], id: "lease-2", startDate: "2026-02-01", endDate: "" });
    owner.state.suppliers = [{ id: "supplier-1", name: "Assureur", legalName: "Assureur SA", siret: "12345678901234", archived: false }];
    Object.assign(owner.state.transactions[0], { tenantId: "tenant-1", leaseId: "lease-1", documentNotRequired: true });
    Object.assign(owner.state.transactions[1], { supplierId: "supplier-1" });
    await save(h, owner);
    const addDocument = async (kind, id, type, marker) => {
      const bytes = Buffer.concat([PDF, Buffer.from(marker)]);
      const response = await h.request(`/api/entities/${kind}/${id}/documents`, {
        cookie: owner.cookie, body: bytes,
        headers: { "X-File-Name": encodeURIComponent(`${marker}.pdf`), "X-Document-Type": type },
      });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      return bytes;
    };
    const bail = await addDocument("lease", "lease-1", "bail", "BAIL-SELECTED");
    const avenant = await addDocument("lease", "lease-1", "avenant", "AVENANT-SELECTED");
    await addDocument("lease", "lease-1", "etat_entree", "ETAT-EXCLUDED");
    await addDocument("tenant", "tenant-1", "autre", "PERSONAL-EXCLUDED");
    await addDocument("lease", "lease-2", "bail", "OTHER-LEASE-EXCLUDED");
    let r = await h.request("/api/exports/accountant", { cookie: owner.cookie, body: { ...dates, operationIds: ["rent-1"] } });
    assert.equal(r.status, 200);
    assert.equal(documentEntries(zipFiles(r.bytes)).length, 0);
    r = await h.request("/api/exports/accountant", { cookie: owner.cookie, body: { ...dates, operationIds: ["rent-1"], includeDocuments: false, includeLeaseDocuments: true } });
    assert.equal(r.status, 200);
    const files = zipFiles(r.bytes);
    assertSimpleArchive(files);
    const docs = documentEntries(files);
    assert.equal(docs.length, 2);
    assert.ok(docs.every(([path]) => path.startsWith("République T2/Encaissements/")));
    assert.ok(docs.some(([,bytes]) => bytes.equals(bail)));
    assert.ok(docs.some(([,bytes]) => bytes.equals(avenant)));
    const rent = csvRows(files.get("operations.csv"))[0];
    assert.equal(rent["ID locataire"], "tenant-1");
    assert.equal(rent["ID location"], "lease-1");
    assert.equal(rent["Locataire"], "Camille Test");
    assert.equal(rent["Justificatif requis"], "Non");
    assert.equal(rent["Justificatif manquant"], "Non");
    for (const path of rent["Baux et avenants inclus"].split("\n")) assert.ok(files.has(path));
    assert.equal(rent["Nombre de justificatifs enregistrés"], "0", "a lease document is not an operation receipt");
  } finally {
    await h.close();
  }
});


test("le ZIP annuel comprend les attentes et conserve une annulation uniquement sur demande sans règlement fictif", async () => {
  const h = await harness();
  try {
    const owner = await account(h);
    await populate(h, owner);
    Object.assign(owner.state.transactions.find(t => t.id === "insurance-1"), {
      cancelledAt: "2026-01-21", cancellationReason: "Facture comptée deux fois",
    });
    await save(h, owner);
    await upload(h, owner, "insurance-1", "assurance-annulee.pdf");
    const options = { startDate: "2026-01-01", endDate: "2026-12-31", dateBasis: "annual", includeDocuments: true };
    let response = await h.request("/api/exports/accountant", { cookie: owner.cookie, body: options });
    assert.equal(response.status, 200);
    let files = zipFiles(response.bytes);
    assertSimpleArchive(files);
    let operations = csvRows(files.get("operations.csv"));
    assert.ok(operations.some(t => t["ID opération"] === "pending-1"), "unpaid current-year invoice included");
    assert.ok(operations.some(t => t["ID opération"] === "rent-1"), "current-year payment of prior debt included");
    assert.ok(!operations.some(t => t["ID opération"] === "insurance-1"));
    assert.equal(documentEntries(files).length, 0);
    response = await h.request("/api/exports/accountant", { cookie: owner.cookie, body: { ...options, includeCancelled: true } });
    assert.equal(response.status, 200);
    files = zipFiles(response.bytes);
    assertSimpleArchive(files);
    operations = csvRows(files.get("operations.csv"));
    const trace = operations.find(t => t["ID opération"] === "insurance-1");
    assert.equal(trace["Statut à la date de l’export"], "Annulée");
    assert.equal(trace["Date d’annulation"], "2026-01-21");
    assert.equal(trace["Motif d’annulation"], "Facture comptée deux fois");
    assert.equal(trace["Règlements conservés avant annulation EUR"], "42,00");
    assert.equal(trace["Total réglé historique EUR"], "0,00");
    assert.equal(trace["Décaissements dans la plage EUR"], "0,00");
    assert.equal(documentEntries(files).length, 1);
    const payments = csvRows(files.get("reglements.csv"));
    assert.ok(!payments.some(p => p["ID opération"] === "insurance-1"));
    assert.ok([...files.keys()].every(name => !/\.(json|md)$/i.test(name)));
  } finally { await h.close(); }
});
