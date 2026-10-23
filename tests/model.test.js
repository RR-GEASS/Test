import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMoney,
  validDate,
  createEmptyState,
  createDemoState,
  validateTransaction,
  validateProperty,
  validateSettings,
  getSummary,
  filterTransactions,
  parseBackup,
  serializeBackup,
  exportCSV,
} from "../src/model.js";
const property = {
  id: "p1",
  name: "Appartement Érable",
  address: "Lyon",
  tenant: "Locataire",
  rentCents: 80000,
  chargesCents: 5000,
  archived: false,
};
function fixture() {
  const s = createEmptyState();
  s.settings = {
    name: "SCI Test",
    taxRegime: "IS",
    openingDate: "2026-01-01",
    openingBalanceCents: 100000,
  };
  s.properties = [{ ...property }];
  return s;
}
function tx(overrides = {}) {
  return {
    id: "t1",
    date: "2026-03-01",
    type: "income",
    status: "paid",
    label: "Loyer",
    category: "rent",
    propertyId: "p1",
    amountCents: 10010,
    counterparty: "",
    reference: "",
    notes: "",
    ...overrides,
  };
}
test("les montants sont convertis en centimes sans cumul d’arrondis", () => {
  assert.equal(parseMoney("1 234,56"), 123456);
  assert.equal(parseMoney("0.10") + parseMoney("0,20"), 30);
  assert.equal(parseMoney("-123,45", true), -12345);
  for (const value of [
    "1,234",
    "1.005",
    "1e3",
    "NaN",
    "Infinity",
    "-12",
    "",
    {},
    "1.234,56",
  ])
    assert.equal(parseMoney(value), null);
});
test("les dates impossibles sont rejetées", () => {
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-13-01"), false);
});
test("la SCI commence à l’IS sans opérations ni biens fictifs", () => {
  const s = createEmptyState();
  assert.equal(s.settings.taxRegime, "IS");
  assert.deepEqual(s.transactions, []);
  assert.deepEqual(s.properties, []);
  assert.equal(s.mode, "real");
});
test("la démonstration est clairement isolée et peut être restaurée sans perte", () => {
  const s = createDemoState();
  assert.equal(s.mode, "demo");
  const restored = parseBackup(serializeBackup(s));
  assert.deepEqual(restored, s);
  assert.ok(s.transactions.length > 0);
});
test("une opération refuse les montants négatifs et les catégories incohérentes", () => {
  const s = fixture();
  let r = validateTransaction(
    {
      date: "2026-03-01",
      label: "Test",
      amount: "-20",
      type: "income",
      category: "maintenance",
      status: "paid",
      propertyId: "absent",
    },
    s,
  );
  assert.ok(r.errors.amount);
  assert.ok(r.errors.category);
  assert.ok(r.errors.propertyId);
  r = validateTransaction(
    {
      date: "2026-03-01",
      label: " Loyer ",
      amount: "800,50",
      type: "income",
      category: "rent",
      status: "paid",
      propertyId: "p1",
    },
    s,
  );
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.amountCents, 80050);
  assert.equal(r.value.label, "Loyer");
});
test("les fiches des biens et le solde initial sont contrôlés", () => {
  assert.ok(validateProperty({ name: "", rent: "abc" }).errors.name);
  assert.ok(validateProperty({ name: "Bien", rent: "-2" }).errors.rent);
  const r = validateSettings({
    name: "SCI",
    taxRegime: "IS",
    openingDate: "2026-01-01",
    openingBalance: "-500,50",
  });
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.openingBalanceCents, -50050);
});
test("les attentes et les mouvements futurs ne gonflent pas les encaissements", () => {
  const s = fixture();
  s.transactions = [
    tx(),
    tx({ id: "t2", status: "pending", amountCents: 30000 }),
    tx({ id: "t3", date: "2026-11-01", amountCents: 40000 }),
  ];
  const r = getSummary(s, { year: 2026, today: "2026-10-23" });
  assert.equal(r.income, 10010);
  assert.equal(r.rent, 10010);
  assert.equal(r.pendingIncome, 30000);
  assert.equal(r.balance, 110010);
  assert.equal(r.overdue.length, 1);
});
test("capital, intérêts et apports affectent la trésorerie sans être des loyers", () => {
  const s = fixture();
  s.transactions = [
    tx({ amountCents: 80000 }),
    tx({
      id: "t2",
      type: "expense",
      category: "loan_capital",
      amountCents: 40000,
    }),
    tx({
      id: "t3",
      type: "expense",
      category: "loan_interest",
      amountCents: 10000,
    }),
    tx({ id: "t4", category: "contribution", amountCents: 50000 }),
  ];
  const r = getSummary(s, { year: 2026, today: "2026-10-23" });
  assert.equal(r.rent, 80000);
  assert.equal(r.expense, 50000);
  assert.equal(r.income, 130000);
  assert.equal(r.balance, 180000);
});
test("le solde respecte sa date initiale et le cumul des années antérieures", () => {
  const s = fixture();
  s.settings.openingDate = "2025-01-01";
  s.transactions = [
    tx({ id: "old", date: "2024-12-01", amountCents: 90000 }),
    tx({ id: "prev", date: "2025-12-01", amountCents: 20000 }),
    tx({ amountCents: 30000 }),
  ];
  const r = getSummary(s, { year: 2026, today: "2026-10-23" });
  assert.equal(r.income, 30000);
  assert.equal(r.balance, 150000);
  assert.equal(
    getSummary(s, { year: 2024, today: "2026-10-23" }).balance,
    null,
  );
});
test("le filtre par bien affiche un solde des mouvements sans répartir le solde bancaire", () => {
  const s = fixture();
  s.transactions = [
    tx({ amountCents: 25000 }),
    tx({
      id: "general",
      propertyId: "",
      category: "contribution",
      amountCents: 500000,
    }),
  ];
  const r = getSummary(s, {
    year: 2026,
    propertyId: "p1",
    today: "2026-10-23",
  });
  assert.equal(r.balance, 25000);
  assert.equal(r.income, 25000);
});
test("le graphique réconcilie exactement les sommes annuelles", () => {
  const s = fixture();
  s.transactions = [
    tx(),
    tx({
      id: "t2",
      date: "2026-04-01",
      type: "expense",
      category: "insurance",
      amountCents: 999,
    }),
  ];
  const r = getSummary(s, { year: 2026, today: "2026-12-31" });
  assert.equal(
    r.monthly.reduce((n, m) => n + m.income, 0),
    r.income,
  );
  assert.equal(
    r.monthly.reduce((n, m) => n + m.expense, 0),
    r.expense,
  );
});
test("recherche sans accents et filtres se combinent", () => {
  const s = fixture();
  s.transactions = [
    tx({
      label: "Réparation chaudière",
      type: "expense",
      category: "maintenance",
    }),
    tx({ id: "t2", propertyId: "", label: "Autre" }),
  ];
  assert.equal(
    filterTransactions(s, {
      year: 2026,
      propertyId: "p1",
      query: "reparation chaudiere",
      category: "maintenance",
    }).length,
    1,
  );
  assert.equal(filterTransactions(s, { status: "pending" }).length, 0);
});
test("l’import refuse les doublons, montants invalides et références absentes", () => {
  for (const mutate of [
    (s) => s.transactions.push({ ...s.transactions[0] }),
    (s) => (s.transactions[0].amountCents = 1.005),
    (s) => (s.transactions[0].propertyId = "absent"),
    (s) => (s.settings.openingBalanceCents = NaN),
    (s) => (s.transactions[0].date = "2026-02-31"),
  ]) {
    const s = fixture();
    s.transactions = [tx()];
    mutate(s);
    assert.throws(() => parseBackup(s));
  }
  assert.throws(() => parseBackup("{oops"));
  assert.throws(() => parseBackup({ tasks: [] }));
});
test("le CSV garde le statut et protège les cellules texte contre les formules Excel", () => {
  const s = fixture();
  s.transactions = [
    tx({
      label: '=HYPERLINK("https://example.test")',
      status: "pending",
      amountCents: 10010,
      notes: "ligne1\nligne2",
    }),
  ];
  const csv = exportCSV(s, s.transactions);
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes("'="));
  assert.ok(csv.includes("En attente"));
  assert.ok(csv.includes("100,10"));
  assert.ok(csv.includes("ligne1\nligne2"));
});
test("une échéance de décembre payée en janvier est comptée au règlement et conserve son échéance", () => {
  const s = fixture();
  s.transactions = [
    tx({ date: "2026-01-02", dueDate: "2025-12-05", amountCents: 80000 }),
  ];
  assert.equal(getSummary(s, { year: 2025, today: "2026-10-23" }).rent, 0);
  assert.equal(getSummary(s, { year: 2026, today: "2026-10-23" }).rent, 80000);
  assert.equal(
    parseBackup(serializeBackup(s)).transactions[0].dueDate,
    "2025-12-05",
  );
  assert.ok(exportCSV(s, s.transactions).includes("2025-12-05"));
});
