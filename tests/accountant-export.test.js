import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyState } from "../src/model.js";
import {
  exportSelection,
  normalizeExportOptions,
  accountantCSVs,
  annualAccountantOptions,
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

test("le CSV distingue la ventilation attendue du prêt des règlements réels et conserve les informations du comptable", () => {
  const s = fixture();
  s.transactions = [{
    ...s.transactions[1],
    id: "loan-1",
    label: "Échéance de prêt",
    category: "loan_payment",
    amountCents: 100000,
    capitalCents: 75000,
    interestCents: 22000,
    insuranceCents: 3000,
    counterparty: "Banque du bien",
    reference: "PRET-2026-01",
    notes: "À rapprocher du tableau bancaire",
    payments: [{ id: "partial-loan", date: "2026-01-15", amountCents: 40000, rentCents: 0, chargesCents: 0 }],
  }];
  const selection = exportSelection(s, january);
  const csvs = accountantCSVs(s, selection);
  const operations = csvs["operations.csv"];
  assert.match(operations, /"Capital de prêt attendu EUR";"Intérêts de prêt attendus EUR";"Assurance emprunteur attendue EUR"/);
  assert.match(operations, /"1000,00";"0,00";"0,00";"750,00";"220,00";"30,00";"400,00";"600,00"/);
  assert.match(operations, /"Banque du bien";"PRET-2026-01";"À rapprocher du tableau bancaire"/);
  assert.match(csvs["reglements.csv"], /"400,00";"0,00";"0,00";"";"400,00"/);
  assert.doesNotMatch(csvs["reglements.csv"], /Capital|Intérêts|Assurance emprunteur/);
});

test("les justificatifs enregistrés sont comptés même si leur contenu est exclu de l’export", () => {
  const s = fixture();
  const selection = exportSelection(s, { ...january, includeDocuments: false });
  const csv = accountantCSVs(s, selection, {
    documents: [
      { id: "doc-1", transactionId: "t1", path: null },
      { id: "doc-2", transactionId: "t1", path: null },
    ],
  })["operations.csv"];
  assert.match(csv, /"Nombre de justificatifs enregistrés";"Justificatif manquant";"Justificatifs inclus"/);
  const rows = csv.split("\r\n");
  assert.match(rows.find((row) => row.startsWith('"t1";')), /;"2";"Non";"";"Non"$/);
  assert.match(rows.find((row) => row.startsWith('"t3";')), /;"0";"Oui";"";"Non"$/);
});

test("le CSV seul utilise les compteurs authentifiés et laisse les justificatifs inconnus en démonstration", () => {
  const s = fixture();
  const selection = exportSelection(s, january);
  const counts = new Map([["t1", 2]]);
  const realCSV = accountantCSVs(s, selection, {
    attachmentCounts: counts,
  })["operations.csv"];
  const realRows = realCSV.split("\r\n");
  assert.match(realRows.find((row) => row.startsWith('"t1";')), /;"2";"Non";"";"Non"$/);
  assert.match(realRows.find((row) => row.startsWith('"t3";')), /;"0";"Oui";"";"Non"$/);
  const demoCSV = accountantCSVs(s, selection, {
    attachmentCounts: null,
  })["operations.csv"];
  for (const row of demoCSV.split("\r\n").slice(1))
    assert.match(row, /;"";"";"";"Non"$/);
  const overriding = accountantCSVs(s, selection, {
    attachmentCounts: counts,
    documents: [{ transactionId: "t1", path: "Bien/Encaissements/preuve.pdf" }],
  })["operations.csv"];
  assert.match(overriding.split("\r\n").find((row) => row.startsWith('"t1";')), /;"2";"Non";"Bien\/Encaissements\/preuve.pdf";"Non"$/);
});

test("les références du répertoire complètent le tiers historique sans transformer une dispense de pièce en manque", () => {
  const s = fixture();
  s.properties[0].tenant = "Nouveau locataire du bien";
  s.tenants = [{ id: "tenant-old", name: "Nom actuel de la fiche" }];
  s.leases = [{ id: "lease-old", tenantId: "tenant-old", propertyId: "p1", startDate: "2025-01-01", endDate: "2025-12-31" }];
  s.suppliers = [{ id: "supplier-1", name: "Assureur", legalName: "Assureur SA", siret: "12345678901234", reference: "CONTRAT-1" }];
  Object.assign(s.transactions[0], { tenantId: "tenant-old", leaseId: "lease-old", documentNotRequired: true });
  Object.assign(s.transactions[1], { supplierId: "supplier-1" });
  const selection = exportSelection(s, { ...january, dateBasis: "period", startDate: "2025-12-01" });
  const csv = accountantCSVs(s, selection, { leaseDocuments: [{ leaseId: "lease-old", path: "République T2/Encaissements/Bail.pdf" }] })["operations.csv"];
  assert.ok(csv.includes('"ID fournisseur";"Fournisseur (fiche actuelle)"'));
  assert.ok(csv.includes('"Assureur";"Assureur SA";"12345678901234"'));
  assert.ok(csv.includes('"tenant-old";"lease-old";"2025-01-01";"2025-12-31";"République T2/Encaissements/Bail.pdf";"Non";"0";"Non"'));
  assert.ok(!csv.includes("Nouveau locataire du bien"));
  assert.ok(!csv.includes("Nom actuel de la fiche"));
  assert.equal(normalizeExportOptions(s, january).includeLeaseDocuments, false);
  assert.throws(() => normalizeExportOptions(s, { ...january, includeLeaseDocuments: "true" }), /options/);
});


test("le dossier annuel inclut les factures non réglées et les règlements de dettes antérieures", () => {
  const s = fixture();
  const options = annualAccountantOptions(2026);
  const result = exportSelection(s, options, { today: "2026-02-01" });
  assert.deepEqual(result.transactions.map(t => t.id), ["t1", "t2", "t3"]);
  assert.equal(result.transactions.find(t => t.id === "t2").payments.length, 0);
  assert.equal(result.payments.filter(p => p.inRange).length, 2);
  assert.equal(result.summary.periodIncomeCents, 52500);
  assert.equal(result.summary.periodExpenseCents, 0);
  assert.equal(options.includeCancelled, false);
  assert.equal(options.includeLeaseDocuments, false);
  assert.throws(() => annualAccountantOptions(99));
});

test("le filtre en retard inclut aussi les échéances partiellement réglées", () => {
  const s = fixture();
  s.transactions[1].payments = [{ id: "partial", date: "2026-01-15", amountCents: 2000, rentCents: 0, chargesCents: 0 }];
  const options = { ...january, dateBasis: "due", statuses: ["overdue"] };
  const result = exportSelection(s, options, { today: "2026-02-01" });
  assert.deepEqual(result.transactions.map(t => t.id), ["t2"]);
  assert.equal(result.summary.periodExpenseCents, 2000);
  assert.equal(exportSelection(s, { ...options, statuses: ["partial"] }, { today: "2026-02-01" }).transactions.length, 1);
});

test("une annulation reste hors du dossier courant et son historique explicite ne crée pas de flux", () => {
  const s = fixture();
  Object.assign(s.transactions[2], { cancelledAt: "2026-01-31", cancellationReason: "Double saisie corrigée" });
  const standard = exportSelection(s, january);
  assert.deepEqual(standard.transactions.map(t => t.id), ["t1"]);
  const trace = exportSelection(s, { ...january, includeCancelled: true });
  assert.deepEqual(trace.transactions.map(t => t.id), ["t1", "t3"]);
  assert.deepEqual(trace.payments.map(p => p.id), ["r2"]);
  assert.equal(trace.summary.periodIncomeCents, 42500);
  const csv = accountantCSVs(s, trace)["operations.csv"];
  const rows = csv.split("\r\n");
  const cells = row => [...row.matchAll(/"((?:""|[^"])*)"/g)].map(m => m[1].replace(/""/g,'"'));
  const headers = cells(rows[0]);
  const cancelled = Object.fromEntries(cells(rows.find(row => row.startsWith('"t3";'))).map((value,index) => [headers[index],value]));
  assert.equal(cancelled["Statut à la date de l’export"], "Annulée");
  assert.equal(cancelled["Date d’annulation"], "2026-01-31");
  assert.equal(cancelled["Motif d’annulation"], "Double saisie corrigée");
  assert.equal(cancelled["Règlements conservés avant annulation EUR"], "100,00");
  assert.equal(cancelled["Total réglé historique EUR"], "0,00");
  assert.equal(cancelled["Encaissements dans la plage EUR"], "0,00");
  assert.equal(cancelled["Reste à régler EUR"], "0,00");
  assert.equal(s.transactions[2].payments.length, 1);
  assert.throws(() => normalizeExportOptions(s, { ...january, includeCancelled: "true" }));
});
