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
  validateRecurrence,
  recurrenceDates,
  generateRecurringTransactions,
  nextRecurrenceDate,
  monthEnd,
  setRecurrenceActive,
  transactionLabel,
  getPayments,
  paidCents,
  remainingCents,
  transactionStatus,
  recordPayment,
  recordPaymentsBatch,
  getForecast,
  suggestedAllocation,
  validateSupplier, validateTenant, validateLease, validateBankCheck, bankBalanceAt,
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
  assert.ok(csv.includes("En retard"));
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

function rule(overrides = {}) {
  const state = fixture();
  const result = validateRecurrence(
    {
      id: "r1",
      type: "income",
      category: "rent",
      propertyId: "p1",
      amount: "850",
      rent: "800",
      charges: "50",
      frequency: "monthly",
      startDate: "2026-01-31",
      endDate: "",
      active: true,
      ...overrides,
    },
    state,
  );
  assert.deepEqual(result.errors, {});
  return result.value;
}
test("les échéances mensuelles gardent le jour d’origine après février", () => {
  assert.deepEqual(recurrenceDates(rule(), "2026-01-01", "2026-04-30"), [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
  assert.equal(monthEnd("2024-02-10"), "2024-02-29");
  assert.deepEqual(
    recurrenceDates(
      rule({ startDate: "2024-02-29", frequency: "yearly" }),
      "2024-01-01",
      "2028-12-31",
    ),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );
  assert.deepEqual(
    recurrenceDates(
      rule({ frequency: "quarterly" }),
      "2026-02-01",
      "2026-12-31",
    ),
    ["2026-04-30", "2026-07-31", "2026-10-31"],
  );
});
test("les dates de début et fin et les règles invalides sont contrôlées", () => {
  assert.deepEqual(
    recurrenceDates(
      rule({ startDate: "2026-01-05", endDate: "2026-03-05" }),
      "2026-01-01",
      "2026-12-31",
    ),
    ["2026-01-05", "2026-02-05", "2026-03-05"],
  );
  const invalid = validateRecurrence(
    {
      type: "expense",
      category: "rent",
      amount: "0",
      frequency: "weekly",
      startDate: "2026-02-31",
      endDate: "2025-01-01",
    },
    fixture(),
  );
  for (const field of [
    "amount",
    "category",
    "frequency",
    "startDate",
    "endDate",
  ])
    assert.ok(invalid.errors[field]);
});
test("la génération est idempotente et ne recrée pas une échéance supprimée", () => {
  const s = fixture();
  s.recurrences = [rule()];
  assert.equal(generateRecurringTransactions(s, "2026-03-31"), 3);
  assert.equal(s.transactions.length, 3);
  assert.ok(
    s.transactions.every(
      (t) => t.status === "pending" && getPayments(t).length === 0,
    ),
  );
  assert.equal(generateRecurringTransactions(s, "2026-03-31"), 0);
  s.transactions.splice(1, 1);
  assert.equal(generateRecurringTransactions(s, "2026-03-31"), 0);
  assert.equal(generateRecurringTransactions(s, "2026-04-30"), 1);
  assert.deepEqual(
    s.transactions.map((t) => t.date),
    ["2026-01-31", "2026-03-31", "2026-04-30"],
  );
});
test("modifier une règle conserve les opérations générées et pause/reprise ne rattrape pas les mois suspendus", () => {
  const s = fixture();
  s.recurrences = [rule({ startDate: "2026-01-05" })];
  generateRecurringTransactions(s, "2026-01-31");
  const first = structuredClone(s.transactions[0]);
  s.recurrences[0].amountCents = 90000;
  s.recurrences[0].rentCents = 85000;
  setRecurrenceActive(s.recurrences[0], false, "2026-02-01");
  assert.equal(generateRecurringTransactions(s, "2026-03-31"), 0);
  setRecurrenceActive(s.recurrences[0], true, "2026-04-10");
  assert.equal(generateRecurringTransactions(s, "2026-04-30"), 0);
  assert.equal(generateRecurringTransactions(s, "2026-05-31"), 1);
  assert.deepEqual(s.transactions[0], first);
  assert.equal(s.transactions[1].amountCents, 90000);
  assert.equal(
    nextRecurrenceDate(s.recurrences[0], "2026-06-01"),
    "2026-06-05",
  );
});
test("les anciennes sauvegardes sans récurrences ni règlements conservent leurs libellés et montants", () => {
  const old = fixture();
  delete old.recurrences;
  old.transactions = [
    tx({ label: "Ancien libellé" }),
    tx({ id: "pending", status: "pending" }),
  ];
  const restored = parseBackup(serializeBackup(old));
  assert.deepEqual(restored.recurrences, []);
  assert.equal(restored.transactions[0].label, "Ancien libellé");
  assert.equal(paidCents(restored.transactions[0]), 10010);
  assert.equal(remainingCents(restored.transactions[1]), 10010);
});
test("un libellé normalisé rassemble le type, le nom court, la catégorie, la période et le détail", () => {
  const s = fixture();
  const result = validateTransaction(
    {
      type: "income",
      category: "rent",
      propertyId: "p1",
      date: "2026-11-05",
      period: "2026-11",
      normalizedLabel: true,
      detail: "Lot A",
      amount: "850",
      rent: "800",
      charges: "50",
      status: "pending",
    },
    s,
  );
  assert.deepEqual(result.errors, {});
  assert.equal(
    result.value.label,
    "Encaissement · Appartement Érable · Loyer et provisions · novembre 2026 · Lot A",
  );
  s.transactions = [result.value];
  assert.equal(filterTransactions(s, { query: "novembre erable" }).length, 0);
  assert.equal(
    filterTransactions(s, { query: "loyer et provisions" }).length,
    1,
  );
  assert.equal(
    transactionLabel(tx({ label: "Libellé libre" }), s),
    "Libellé libre",
  );
  assert.ok(
    validateProperty(
      {
        ...property,
        name: "appartement erable",
        rent: "800",
        charges: "50",
        id: "another",
      },
      s,
    ).errors.name,
  );
});
test("un règlement partiel ventile les centimes exactement et le solde conserve chaque date effective", () => {
  const s = fixture();
  s.transactions = [
    tx({
      date: "2025-12-05",
      dueDate: "2025-12-05",
      category: "rent",
      amountCents: 85000,
      rentCents: 80000,
      chargesCents: 5000,
      status: "pending",
      payments: [],
    }),
  ];
  recordPayment(s, "t1", { date: "2025-12-20", amount: "425" });
  assert.equal(paidCents(s.transactions[0]), 42500);
  assert.equal(remainingCents(s.transactions[0]), 42500);
  assert.equal(transactionStatus(s.transactions[0], "2026-01-10"), "partial");
  assert.deepEqual(
    s.transactions[0].payments.map((p) => [p.rentCents, p.chargesCents]),
    [[40000, 2500]],
  );
  recordPayment(s, "t1", { date: "2026-01-10", amount: "425" });
  assert.equal(transactionStatus(s.transactions[0]), "paid");
  assert.equal(
    getSummary(s, { year: 2025, today: "2026-02-01" }).income,
    42500,
  );
  assert.equal(
    getSummary(s, { year: 2026, today: "2026-02-01" }).income,
    42500,
  );
  assert.equal(getSummary(s, { year: 2026, today: "2026-02-01" }).rent, 40000);
  assert.equal(
    parseBackup(serializeBackup(s)).transactions[0].payments.length,
    2,
  );
});
test("la ventilation proportionnelle des petits règlements ne crée ni ne perd un centime", () => {
  const s = fixture();
  s.transactions = [
    tx({
      amountCents: 7,
      rentCents: 5,
      chargesCents: 2,
      status: "pending",
      payments: [],
    }),
  ];
  for (let i = 0; i < 7; i++)
    recordPayment(s, "t1", { date: "2026-03-01", amount: "0,01" });
  assert.equal(paidCents(s.transactions[0]), 7);
  assert.equal(
    s.transactions[0].payments.reduce((n, p) => n + p.rentCents, 0),
    5,
  );
  assert.equal(
    s.transactions[0].payments.reduce((n, p) => n + p.chargesCents, 0),
    2,
  );
});
test("la ventilation manuelle est contrôlée et un règlement excessif ne modifie rien", () => {
  const s = fixture();
  s.transactions = [
    tx({
      amountCents: 85000,
      rentCents: 80000,
      chargesCents: 5000,
      status: "pending",
      payments: [],
    }),
  ];
  recordPayment(s, "t1", {
    date: "2026-03-01",
    amount: "100",
    rentAmount: "95",
    chargesAmount: "5",
  });
  const before = serializeBackup(s);
  assert.throws(() =>
    recordPayment(s, "t1", { date: "2026-03-01", amount: "800" }),
  );
  assert.throws(() =>
    recordPayment(s, "t1", {
      date: "2026-03-01",
      amount: "100",
      rentAmount: "20",
      chargesAmount: "80",
    }),
  );
  assert.throws(() =>
    recordPayment(s, "t1", { date: "2026-02-31", amount: "1" }),
  );
  // Ignore the export timestamp: all financial state must remain unchanged.
  assert.deepEqual(parseBackup(serializeBackup(s)), parseBackup(before));
  const invalid = structuredClone(s);
  invalid.transactions[0].payments[0].chargesCents = 1;
  assert.throws(() => parseBackup(invalid));
});
test("un pointage groupé est atomique et ne repointe pas une opération réglée", () => {
  const s = fixture();
  s.transactions = [
    tx({ status: "pending" }),
    tx({ id: "t2", status: "pending", type: "expense", category: "insurance" }),
  ];
  const before = structuredClone(s);
  assert.throws(() => recordPaymentsBatch(s, ["t1", "absent"], "2026-03-15"));
  assert.deepEqual(s, before);
  assert.equal(recordPaymentsBatch(s, ["t1", "t2"], "2026-03-15"), 2);
  assert.equal(
    getSummary(s, { year: 2026, today: "2026-04-01" }).income,
    10010,
  );
  assert.equal(
    getSummary(s, { year: 2026, today: "2026-04-01" }).expense,
    10010,
  );
  assert.throws(() => recordPaymentsBatch(s, ["t1"], "2026-03-15"));
});
test("les imports refusent les paiements supérieurs à l’échéance et les occurrences dupliquées", () => {
  const s = fixture();
  s.recurrences = [rule()];
  generateRecurringTransactions(s, "2026-01-31");
  const duplicate = structuredClone(s);
  duplicate.transactions.push({
    ...duplicate.transactions[0],
    id: "another-id",
  });
  assert.throws(() => parseBackup(duplicate));
  const overpaid = structuredClone(s);
  overpaid.transactions[0].payments = [
    {
      id: "p",
      date: "2026-01-31",
      amountCents: 90000,
      rentCents: 85000,
      chargesCents: 5000,
    },
  ];
  assert.throws(() => parseBackup(overpaid));
});
test("le prévisionnel distingue les retards, les règlements réels et les échéances futures sans doublons", () => {
  const s = fixture();
  s.recurrences = [rule({ startDate: "2026-01-05", endDate: "2026-04-05" })];
  generateRecurringTransactions(s, "2026-02-28");
  recordPayment(s, s.transactions[0].id, { date: "2026-01-05", amount: "850" });
  const r = getForecast(s, { today: "2026-02-10", months: 3 });
  assert.equal(r.openingBalance, 185000);
  assert.equal(r.overdueIncome, 85000);
  assert.equal(r.months[0].income, 0);
  assert.equal(r.months[1].income, 85000);
  assert.equal(r.months[2].income, 85000);
  assert.equal(r.months[2].balance, 355000);
  s.transactions.splice(1, 1);
  const afterDelete = getForecast(s, { today: "2026-02-10", months: 3 });
  assert.equal(afterDelete.months[0].income, 0);
  assert.equal(afterDelete.overdueIncome, 0);
});
test("un règlement futur est projeté sans être inclus dans le solde réel", () => {
  const s = fixture();
  s.transactions = [
    tx({
      date: "2026-03-01",
      amountCents: 10000,
      status: "pending",
      payments: [
        {
          id: "future",
          date: "2026-05-01",
          amountCents: 4000,
          rentCents: 4000,
          chargesCents: 0,
        },
      ],
    }),
  ];
  const forecast = getForecast(s, { today: "2026-04-01", months: 2 });
  assert.equal(forecast.openingBalance, 100000);
  assert.equal(forecast.overdueIncome, 6000);
  assert.equal(forecast.months[1].income, 4000);
  assert.equal(forecast.months[1].balance, 104000);
});
test("une dépense périodique sans ventilation locative reste sauvegardable", () => {
  const s = fixture();
  s.recurrences = [
    rule({
      type: "expense",
      category: "insurance",
      amount: "85",
      rent: undefined,
      charges: undefined,
    }),
  ];
  generateRecurringTransactions(s, "2026-03-31");
  assert.equal(s.transactions.length, 3);
  assert.equal(s.transactions[0].rentCents, 0);
  assert.deepEqual(parseBackup(serializeBackup(s)), s);
});
test("la ventilation proposée reste exacte même près de la limite des montants", () => {
  const t = tx({
    amountCents: 100000000000,
    rentCents: 99999999999,
    chargesCents: 1,
    status: "pending",
    payments: [],
  });
  assert.deepEqual(suggestedAllocation(t, 100000000000), {
    rentCents: 99999999999,
    chargesCents: 1,
  });
  assert.deepEqual(suggestedAllocation(t, 0), {
    rentCents: 0,
    chargesCents: 0,
  });
  assert.throws(() => suggestedAllocation(t, 100000000001));
});
test("une périodicité commençant au-delà de deux ans a bien une prochaine échéance", () => {
  assert.equal(
    nextRecurrenceDate(rule({ startDate: "2035-08-31" }), "2026-01-01"),
    "2035-08-31",
  );
});
test("le journal retrouve les règlements tardifs et le CSV annuel garde leur exercice réel", () => {
  const s = fixture();
  s.transactions = [
    tx({
      date: "2026-12-05",
      dueDate: "2026-12-05",
      amountCents: 85000,
      rentCents: 80000,
      chargesCents: 5000,
      status: "pending",
      payments: [],
    }),
  ];
  recordPayment(s, "t1", { date: "2027-01-10", amount: "850" });
  assert.equal(filterTransactions(s, { year: 2026 }).length, 1);
  assert.equal(filterTransactions(s, { year: 2027 }).length, 1);
  const csv2026 = exportCSV(s, filterTransactions(s, { year: 2026 }), {
    year: 2026,
  });
  const csv2027 = exportCSV(s, filterTransactions(s, { year: 2027 }), {
    year: 2027,
  });
  assert.equal(csv2026.split("\r\n").length, 1);
  assert.ok(!csv2026.includes("2027-01-10"));
  assert.ok(csv2027.includes('"2027-01-10"'));
  assert.ok(csv2027.includes('"850,00"'));
  assert.ok(exportCSV(s, s.transactions).includes("2027-01-10"));
});
test("un export annuel sépare les règlements partiels des années voisines et conserve le reste dû sans le compter en trésorerie", () => {
  const s = fixture();
  s.transactions = [
    tx({
      date: "2026-12-05",
      amountCents: 85000,
      rentCents: 80000,
      chargesCents: 5000,
      status: "pending",
      payments: [],
    }),
  ];
  recordPayment(s, "t1", { date: "2026-12-20", amount: "200" });
  recordPayment(s, "t1", { date: "2027-01-10", amount: "300" });
  const csv2026 = exportCSV(s, filterTransactions(s, { year: 2026 }), {
    year: 2026,
  });
  const csv2027 = exportCSV(s, filterTransactions(s, { year: 2027 }), {
    year: 2027,
  });
  assert.ok(csv2026.includes("2026-12-20"));
  assert.ok(!csv2026.includes("2027-01-10"));
  assert.ok(csv2027.includes("2027-01-10"));
  assert.ok(!csv2027.includes("2026-12-20"));
  const rows = csv2026
    .split("\r\n")
    .slice(1)
    .map((line) =>
      [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) =>
        match[1].replace(/""/g, '"'),
      ),
    );
  assert.equal(rows.length, 2); // One actual 2026 receipt and one outstanding-due row.
  assert.equal(
    rows.reduce((n, row) => n + parseMoney(row[7] || "0"), 0),
    20000,
  );
  assert.equal(
    rows.reduce((n, row) => n + parseMoney(row[15] || "0"), 0),
    35000,
  );
  assert.equal(
    getSummary(s, { year: 2026, today: "2027-02-01" }).pendingIncome,
    35000,
  );
  assert.equal(
    getSummary(s, { year: 2027, today: "2027-02-01" }).pendingIncome,
    0,
  );
});

function loanInput(overrides = {}) {
  return {
    id: "loan1",
    date: "2026-03-05",
    type: "expense",
    status: "pending",
    label: "Prêt République",
    category: "loan_payment",
    propertyId: "p1",
    capital: "750,00",
    interest: "220,00",
    insurance: "30,00",
    counterparty: "Banque Test",
    reference: "PR-2026",
    notes: "Note pour le comptable",
    ...overrides,
  };
}

test("une échéance de prêt calcule exactement son total et contrôle sa ventilation", () => {
  const s = fixture();
  const valid = validateTransaction(loanInput(), s);
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.value.amountCents, 100000);
  assert.equal(valid.value.capitalCents, 75000);
  assert.equal(valid.value.interestCents, 22000);
  assert.equal(valid.value.insuranceCents, 3000);
  for (const overrides of [
    { amount: "999,99" },
    { capital: "-1" },
    { interest: "1,001" },
    { insurance: "NaN" },
    { capital: "1000000000", interest: "1", insurance: "0" },
    { capital: "0", interest: "0", insurance: "0" },
    { capital: undefined, capitalCents: null },
    { capital: undefined, capitalCents: "75000" },
    { capital: undefined, interest: undefined, insurance: undefined, amount: "1000" },
    { category: "insurance", amount: "1000" },
  ]) assert.ok(validateTransaction(loanInput(overrides), s).errors.amount);
  assert.deepEqual(validateTransaction(loanInput({ capital: "1000", interest: "0", insurance: "0" }), s).errors, {});
});

test("le prêt périodique transmet sa ventilation et les informations du comptable à chaque échéance", () => {
  const s = fixture();
  const result = validateRecurrence({
    ...loanInput(), id: "pr1", frequency: "monthly", startDate: "2026-01-05",
  }, s);
  assert.deepEqual(result.errors, {});
  s.recurrences = [result.value];
  assert.equal(generateRecurringTransactions(s, "2026-02-28"), 2);
  for (const t of s.transactions) {
    assert.equal(t.amountCents, 100000);
    assert.equal(t.capitalCents, 75000);
    assert.equal(t.interestCents, 22000);
    assert.equal(t.insuranceCents, 3000);
    assert.equal(t.counterparty, "Banque Test");
    assert.equal(t.reference, "PR-2026");
    assert.equal(t.notes, "Note pour le comptable");
  }
  assert.deepEqual(parseBackup(serializeBackup(s)), s);
});

test("adapter la ventilation d’une échéance de prêt conserve les autres mois et la règle", () => {
  const s = fixture();
  s.recurrences = [validateRecurrence({ ...loanInput(), id: "pr1", frequency: "monthly", startDate: "2026-01-05" }, s).value];
  generateRecurringTransactions(s, "2026-02-28");
  const ruleBefore = structuredClone(s.recurrences[0]);
  const otherMonth = structuredClone(s.transactions[1]);
  const first = s.transactions[0];
  const edited = validateTransaction({ ...first, capital: "760", interest: "210", insurance: "30" }, s);
  assert.deepEqual(edited.errors, {});
  s.transactions[0] = edited.value;
  recordPayment(s, first.id, { date: "2026-01-05", amount: "1000" });
  const paid = s.transactions[0];
  const corrected = validateTransaction({ ...paid, capital: "765", interest: "205", insurance: "30" }, s);
  assert.deepEqual(corrected.errors, {});
  assert.deepEqual(corrected.value.payments, paid.payments);
  // Old paid operations have a synthetic payment, so their total is locked too.
  const legacy = validateTransaction(loanInput({ status: "paid" }), fixture()).value;
  const legacyState = fixture();
  legacyState.transactions = [legacy];
  assert.deepEqual(validateTransaction({ ...legacy, capital: "760", interest: "210", insurance: "30" }, legacyState).errors, {});
  assert.ok(validateTransaction({ ...legacy, capital: "760", interest: "220", insurance: "30" }, legacyState).errors.amount);
  const changedTotal = validateTransaction({ ...paid, capital: "765", interest: "210", insurance: "30" }, s);
  assert.ok(changedTotal.errors.amount);
  assert.deepEqual(s.recurrences[0], ruleBefore);
  assert.deepEqual(s.transactions[1], otherMonth);
  s.transactions[0] = corrected.value;
  assert.deepEqual(parseBackup(serializeBackup(s)), s);
});

test("les sauvegardes refusent les ventilations de prêt invalides sur les opérations et périodicités", () => {
  const s = fixture();
  s.transactions = [validateTransaction(loanInput(), s).value];
  s.recurrences = [validateRecurrence({ ...loanInput(), id: "pr1", frequency: "monthly", startDate: "2026-01-05" }, s).value];
  for (const list of ["transactions", "recurrences"]) {
    for (const value of [null, -1, 1.5, "75000", 99999]) {
      const invalid = structuredClone(s);
      invalid[list][0].capitalCents = value;
      assert.throws(() => parseBackup(serializeBackup(invalid)), /invalide/);
    }
  }
});

test("les informations du comptable des périodicités respectent les limites de saisie", () => {
  const s = fixture();
  const input = { ...loanInput(), frequency: "monthly", startDate: "2026-01-05" };
  assert.ok(validateRecurrence({ ...input, counterparty: "x".repeat(161) }, s).errors.counterparty);
  assert.ok(validateRecurrence({ ...input, reference: "x".repeat(101) }, s).errors.reference);
  assert.ok(validateRecurrence({ ...input, notes: "x".repeat(3001) }, s).errors.notes);
  for (const category of ["loan_capital", "loan_interest"]) {
    assert.deepEqual(validateTransaction(loanInput({ category, amount: "100", capital: undefined, interest: undefined, insurance: undefined }), s).errors, {});
  }
});

test("le CSV de trésorerie distingue la ventilation prévue du prêt des règlements sans la dupliquer", () => {
  const s = fixture();
  const result = validateTransaction(loanInput(), s);
  s.transactions.push(result.value);
  recordPayment(s, result.value.id, { date: "2026-03-05", amount: "400" });
  recordPayment(s, result.value.id, { date: "2026-03-20", amount: "600" });
  const csv = exportCSV(s, s.transactions);
  const rows = csv.replace(/^\ufeff/, "").split("\r\n").map((row) => row.split(";").map((cell) => cell.slice(1, -1)));
  const column = rows[0].indexOf("Capital prévu du prêt EUR");
  assert.ok(column > 0);
  assert.deepEqual(rows[1].slice(column), ["750,00", "220,00", "30,00"]);
  assert.deepEqual(rows[2].slice(column), ["", "", ""]);
  const optional = validateTransaction(loanInput({ capital: "1000", interest: "", insurance: "  " }), s);
  assert.deepEqual(optional.errors, {});
  assert.equal(optional.value.interestCents, 0);
  assert.equal(optional.value.insuranceCents, 0);
});


function directoryFixture() {
  const s = fixture();
  s.suppliers.push(validateSupplier({ id: "supplier-1", name: "Électricité", legalName: "Énergie Exemple", category: "other_expense", reference: "CONTRAT-1", archived: false }, s).value);
  s.tenants.push(validateTenant({ id: "tenant-1", name: "Camille", email: "camille@example.test", archived: false }).value);
  const lease = validateLease({ id: "lease-1", tenantId: "tenant-1", propertyId: "p1", startDate: "2026-01-10", endDate: "", rent: "800", charges: "50", deposit: "800", paymentDay: 31 }, s);
  assert.deepEqual(lease.errors, {});
  s.leases.push(lease.value);
  return s;
}
test("les anciens dossiers restent lisibles sans inventer de contacts ou de locations", () => {
  const old = fixture();
  for (const key of ["suppliers", "tenants", "leases", "bankChecks"]) delete old[key];
  const restored = parseBackup(old);
  for (const key of ["suppliers", "tenants", "leases", "bankChecks"]) assert.deepEqual(restored[key], []);
  assert.equal(restored.properties[0].tenant, "Locataire");
  assert.throws(() => parseBackup({ ...old, suppliers: null }));
});
test("les fiches fournisseurs et locataires contrôlent coordonnées et noms sans fusionner les homonymes", () => {
  const s = directoryFixture();
  assert.ok(validateSupplier({ name: " electricite " }, s).errors.name);
  assert.ok(validateSupplier({ name: "Autre", email: "invalide", siret: "123", category: "rent" }, s).errors.email);
  assert.ok(validateSupplier({ name: "Autre", category: "rent" }, s).errors.category);
  assert.deepEqual(validateTenant({ name: "Camille" }, s).errors, {});
  assert.ok(validateTenant({ name: "Camille", archived: "false" }).errors.archived);
  const restored = parseBackup(serializeBackup(s));
  assert.deepEqual(restored.suppliers, s.suppliers);
  assert.deepEqual(restored.tenants, s.tenants);
  assert.deepEqual(restored.leases, s.leases);
});
test("une location conserve son bien et son locataire lorsqu’elle possède un historique", () => {
  const s = directoryFixture();
  const original = s.leases[0];
  assert.ok(validateLease({ ...original, id: "lease-2" }, s).errors.startDate);
  assert.ok(validateLease({ ...original, endDate: "2026-01-01" }, s).errors.endDate);
  assert.ok(validateLease({ ...original, paymentDay: 32 }, s).errors.paymentDay);
  s.tenants.push(validateTenant({ id: "tenant-2", name: "Alex" }).value);
  s.transactions.push(tx({ tenantId: "tenant-1", leaseId: "lease-1" }));
  assert.ok(validateLease({ ...original, tenantId: "tenant-2" }, s).errors.tenantId);
  const ended = validateLease({ ...original, endDate: "2026-03-31" }, s);
  assert.deepEqual(ended.errors, {});
  s.leases[0] = ended.value;
  assert.deepEqual(validateLease({ ...original, id: "lease-2", tenantId: "tenant-2", startDate: "2026-04-01" }, s).errors, {});
  assert.equal(s.transactions[0].tenantId, "tenant-1");
});
test("les opérations gardent leur tiers historique et refusent les liens de fiches incohérents", () => {
  const s = directoryFixture();
  const input = { ...tx({ status: "pending" }), amount: "100,10", tenantId: "tenant-1", leaseId: "lease-1", counterparty: "Camille au jour du paiement", documentNotRequired: true };
  const result = validateTransaction(input, s);
  assert.deepEqual(result.errors, {});
  s.transactions.push(result.value);
  s.tenants[0].name = "Camille Nouveau";
  assert.equal(parseBackup(serializeBackup(s)).transactions[0].counterparty, "Camille au jour du paiement");
  assert.ok(validateTransaction({ ...input, supplierId: "supplier-1" }, s).errors.supplierId);
  assert.ok(validateTransaction({ ...input, tenantId: "missing" }, s).errors.tenantId);
  assert.ok(validateTransaction({ ...input, propertyId: "" }, s).errors.leaseId);
  assert.ok(validateTransaction({ ...input, documentNotRequired: "true" }, s).errors.documentNotRequired);
  const bad = structuredClone(s); bad.transactions[0].leaseId = "another-account";
  assert.throws(() => parseBackup(bad));
});
test("les échéances liées respectent les dates de location et gardent le jour prévu", () => {
  const s = directoryFixture();
  const rule = validateRecurrence({ id: "lease-rule", type: "income", category: "rent", propertyId: "p1", tenantId: "tenant-1", leaseId: "lease-1", startDate: "2025-12-31", frequency: "monthly", rent: "800", charges: "50", counterparty: "Camille", documentNotRequired: true }, s);
  assert.deepEqual(rule.errors, {});
  s.recurrences.push(rule.value);
  assert.equal(generateRecurringTransactions(s, "2026-02-28"), 2);
  assert.deepEqual(s.transactions.map(t => t.date), ["2026-01-31", "2026-02-28"]);
  for (const t of s.transactions) {
    assert.equal(t.tenantId, "tenant-1"); assert.equal(t.leaseId, "lease-1"); assert.equal(t.documentNotRequired, true);
  }
  const history = structuredClone(s.transactions);
  s.leases[0].endDate = "2026-03-15";
  assert.equal(generateRecurringTransactions(s, "2026-04-30"), 0);
  assert.deepEqual(s.transactions, history);
  const forecast = getForecast(s, { today: "2026-03-01", months: 3 });
  assert.equal(forecast.months.reduce((n,m) => n + m.income, 0), 0);
  assert.deepEqual(parseBackup(serializeBackup(s)).recurrences[0].leaseId, "lease-1");
});
test("les contrôles bancaires comparent le solde au jour choisi et conservent les montants négatifs", () => {
  const s = fixture();
  s.transactions = [tx({ date: "2026-01-01", amountCents: 10000 }), tx({ id: "expense", type: "expense", category: "insurance", date: "2026-01-15", amountCents: 4000 }), tx({ id: "future", date: "2026-02-01", amountCents: 10000 }), tx({ id: "pending", date: "2026-01-02", status: "pending", amountCents: 99999 })];
  assert.equal(bankBalanceAt(s, "2026-01-01"), 110000);
  assert.equal(bankBalanceAt(s, "2026-01-31"), 106000);
  assert.equal(bankBalanceAt(s, "2025-12-31"), null);
  const check = validateBankCheck({ id: "check-1", date: "2026-01-31", balance: "-42,30", notes: "Solde du relevé" }, s);
  assert.deepEqual(check.errors, {});
  assert.equal(check.value.balanceCents, -4230);
  s.bankChecks.push(check.value);
  assert.ok(validateBankCheck({ date: "2026-01-31", balance: "0" }, s).errors.date);
  assert.deepEqual(parseBackup(serializeBackup(s)).bankChecks, s.bankChecks);
  const bad = structuredClone(s); bad.bankChecks[0].balanceCents = 1.2; bad.bankChecks[0].balance = "10";
  assert.throws(() => parseBackup(bad));
});


test("un loyer au 31 démarré en février retrouve le 31 en mars et conserve son jour à la restauration", () => {
  const s = directoryFixture();
  s.leases[0].startDate = "2026-02-28";
  const input = { id: "last-day", type: "income", category: "rent", propertyId: "p1", tenantId: "tenant-1", leaseId: "lease-1", startDate: "2026-02-28", frequency: "monthly", paymentDay: 31, rent: "800", charges: "50" };
  const result = validateRecurrence(input, s);
  assert.deepEqual(result.errors, {});
  s.recurrences.push(result.value);
  assert.deepEqual(recurrenceDates(result.value, "2026-02-01", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(nextRecurrenceDate(result.value, "2026-03-01"), "2026-03-31");
  generateRecurringTransactions(s, "2026-04-30");
  assert.deepEqual(s.transactions.map(t => t.date), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(parseBackup(serializeBackup(s)).recurrences[0].paymentDay, 31);
  assert.ok(validateRecurrence({ ...input, paymentDay: 32 }, s).errors.paymentDay);
  assert.ok(validateRecurrence({ ...input, paymentDay: 1.5 }, s).errors.paymentDay);
});


test("l’identité d’une location enregistrée reste fixe même avant sa première opération", () => {
  const s = directoryFixture();
  s.tenants.push(validateTenant({ id: "tenant-2", name: "Autre occupant" }).value);
  s.properties.push({ ...s.properties[0], id: "p2", name: "Autre bien" });
  assert.equal(s.transactions.length, 0);
  assert.equal(s.recurrences.length, 0);
  assert.ok(validateLease({ ...s.leases[0], tenantId: "tenant-2" }, s).errors.tenantId);
  assert.ok(validateLease({ ...s.leases[0], propertyId: "p2" }, s).errors.propertyId);
  assert.deepEqual(validateLease({ ...s.leases[0], rent: "850", notes: "Loyer corrigé" }, s).errors, {});
});
test("déplacer le solde initial conserve les anciens contrôles sans inventer un solde calculé", () => {
  const s = fixture();
  s.bankChecks.push(validateBankCheck({ id: "old-check", date: "2026-02-28", balance: "500" }, s).value);
  s.settings.openingDate = "2026-03-01";
  const restored = parseBackup(serializeBackup(s));
  assert.deepEqual(restored.bankChecks, s.bankChecks);
  assert.equal(bankBalanceAt(restored, "2026-02-28"), null);
  assert.ok(validateBankCheck({ date: "2026-02-27", balance: "500" }, restored).errors.date);
  const bad = structuredClone(restored); bad.bankChecks[0].date = "2026-02-31";
  assert.throws(() => parseBackup(bad));
});


test("les rattachements fournisseur-bien restent des identifiants validés dans la sauvegarde", () => {
  const s = directoryFixture();
  s.properties[0].supplierIds = [s.suppliers[0].id];
  const restored = parseBackup(serializeBackup(s));
  assert.deepEqual(restored.properties[0].supplierIds, [s.suppliers[0].id]);
  const invalid = structuredClone(s); invalid.properties[0].supplierIds = ["inconnu"];
  assert.throws(() => parseBackup(invalid), /fournisseur/i);
  assert.ok(validateProperty({...s.properties[0],rent:"800",charges:"50",supplierIds:["inconnu"]},s).errors.supplierIds);
});
