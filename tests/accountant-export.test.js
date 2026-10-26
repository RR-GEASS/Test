import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyState } from "../src/model.js";
import {
  exportSelection,
  normalizeExportOptions,
  accountantCSVs,
} from "../src/accountant-export.js";
function fixture() {
  const s = createEmptyState();
  s.settings = {
    name: "SCI Export",
    taxRegime: "IS",
    openingDate: "2025-01-01",
    openingBalanceCents: 10000,
  };
  s.properties = [
    {
      id: "p1",
      name: "République T2",
      address: "Rue des Tests",
      tenant: "Camille",
      rentCents: 80000,
      chargesCents: 5000,
      archived: false,
    },
  ];
  const base = {
    type: "income",
    category: "rent",
    propertyId: "p1",
    date: "2025-12-05",
    dueDate: "2025-12-05",
    period: "2025-12",
    label: "Loyer décembre",
    amountCents: 85000,
    rentCents: 80000,
    chargesCents: 5000,
    counterparty: "Camille",
    reference: "FAC-001",
    notes: "Une note complète",
    status: "paid",
    payments: [
      {
        id: "r1",
        date: "2025-12-15",
        amountCents: 42500,
        rentCents: 40000,
        chargesCents: 2500,
      },
      {
        id: "r2",
        date: "2026-01-15",
        amountCents: 42500,
        rentCents: 40000,
        chargesCents: 2500,
      },
    ],
  };
  s.transactions = [
    { ...base, id: "t1" },
    {
      ...base,
      id: "t2",
      label: "Assurance",
      date: "2026-01-01",
      dueDate: "2026-01-01",
      period: "2026-01",
      type: "expense",
      category: "insurance",
      amountCents: 4200,
      rentCents: 0,
      chargesCents: 0,
      status: "pending",
      payments: [],
    },
    {
      ...base,
      id: "t3",
      label: "Apport",
      date: "2026-01-31",
      dueDate: "2026-01-31",
      period: "2026-01",
      propertyId: "",
      category: "contribution",
      amountCents: 10000,
      rentCents: 0,
      chargesCents: 0,
      payments: [
        {
          id: "r3",
          date: "2026-01-31",
          amountCents: 10000,
          rentCents: 0,
          chargesCents: 0,
        },
      ],
    },
  ];
  return s;
}
const january = { startDate: "2026-01-01", endDate: "2026-01-31" };
test("sélection des dates réelles inclusive et paiements traversant deux exercices", () => {
  const result = exportSelection(fixture(), january, { today: "2026-02-01" });
  assert.deepEqual(
    result.transactions.map((t) => t.id),
    ["t1", "t3"],
  );
  assert.deepEqual(
    result.payments.map((p) => p.id),
    ["r2", "r3"],
  );
  assert.equal(result.summary.periodIncomeCents, 52500);
  assert.equal(result.summary.periodExpenseCents, 0);
});
test("l’historique supplémentaire est repéré et ne gonfle pas les totaux de la plage", () => {
  const result = exportSelection(fixture(), {
    ...january,
    includeFullPaymentHistory: true,
  });
  assert.equal(result.payments.length, 3);
  assert.equal(result.payments.find((p) => p.id === "r1").inRange, false);
  assert.equal(result.summary.periodIncomeCents, 52500);
});
test("la sélection par échéance inclut les attentes et leurs règlements hors plage", () => {
  const result = exportSelection(
    fixture(),
    { ...january, dateBasis: "due" },
    { today: "2026-02-01" },
  );
  assert.deepEqual(
    result.transactions.map((t) => t.id),
    ["t2", "t3"],
  );
  assert.equal(result.summary.periodIncomeCents, 10000);
  const december = exportSelection(fixture(), {
    startDate: "2025-12-01",
    endDate: "2025-12-31",
    dateBasis: "due",
  });
  assert.equal(december.payments.length, 2);
  assert.equal(december.payments.filter((p) => p.inRange).length, 1);
  assert.equal(december.summary.periodIncomeCents, 42500);
});
test("la période sélectionne des mois entiers et les filtres se combinent", () => {
  const s = fixture();
  const result = exportSelection(s, {
    startDate: "2025-12-30",
    endDate: "2025-12-30",
    dateBasis: "period",
    propertyIds: ["p1"],
    categories: ["rent"],
    types: ["income"],
    statuses: ["paid"],
    query: "republique",
  });
  assert.deepEqual(
    result.transactions.map((t) => t.id),
    ["t1"],
  );
  assert.equal(result.payments.length, 2);
  assert.equal(result.summary.periodIncomeCents, 0);
});
test("sélection explicite vide signifie aucune opération, filtre omis signifie toutes", () => {
  const s = fixture();
  assert.equal(exportSelection(s, january).transactions.length, 2);
  assert.equal(
    exportSelection(s, { ...january, operationIds: [] }).transactions.length,
    0,
  );
  assert.deepEqual(
    exportSelection(s, { ...january, operationIds: ["t3"] }).transactions.map(
      (t) => t.id,
    ),
    ["t3"],
  );
});
test("les dates et critères inconnus sont refusés sans modifier la sélection originale", () => {
  const s = fixture();
  for (const input of [
    { ...january, startDate: "2026-02-31" },
    { ...january, startDate: "2026-02-01" },
    { ...january, dateBasis: "all" },
    { ...january, propertyIds: ["other-user-property"] },
    { ...january, operationIds: ["unknown"] },
    { ...january, categories: ["unknown"] },
    { ...january, types: ["payment"] },
    { ...january, statuses: ["finished"] },
    { ...january, includeDocuments: "true" },
    { ...january, query: {} },
  ])
    assert.throws(() => normalizeExportOptions(s, input));
  const input = { ...january, categories: ["rent", "rent"] };
  normalizeExportOptions(s, input);
  assert.equal(input.categories.length, 2);
});
test("le CSV fournit les détails attendus, réglés, périodes et protège les formules Excel", () => {
  const s = fixture();
  s.transactions[0].notes = ' \t=HYPERLINK("https://example.test")';
  s.properties[0].tenant = "@FORMULE";
  const selection = exportSelection(s, {
    ...january,
    includeFullPaymentHistory: true,
  });
  const csvs = accountantCSVs(s, selection, {
    today: "2026-02-01",
    documents: [{ transactionId: "t1", path: "justifs/00001/loyer.pdf" }],
  });
  assert.deepEqual(Object.keys(csvs), [
    "operations.csv",
    "reglements.csv",
    "biens.csv",
  ]);
  for (const csv of Object.values(csvs)) assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csvs["operations.csv"].includes("Rue des Tests"));
  assert.ok(csvs["operations.csv"].includes("FAC-001"));
  assert.ok(csvs["operations.csv"].includes("justifs/00001/loyer.pdf"));
  assert.ok(csvs["operations.csv"].includes("' \t="));
  assert.ok(csvs["biens.csv"].includes("'@FORMULE"));
  assert.ok(csvs["reglements.csv"].includes("2025-12-15"));
  assert.ok(csvs["reglements.csv"].includes('"Non"'));
  assert.ok(csvs["reglements.csv"].includes('"400,00"'));
  assert.ok(csvs["reglements.csv"].includes('"25,00"'));
});
