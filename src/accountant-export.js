import {
  CATEGORIES,
  categoryFor,
  clean,
  fold,
  getPayments,
  moneyInput,
  paidCents,
  remainingCents,
  transactionLabel,
  transactionStatus,
  validDate,
} from "./model.js";

const DATE_BASES = ["payments", "due", "period"];
const STATUSES = ["paid", "partial", "pending", "overdue"];
const TYPES = ["income", "expense"];
const optionArrays = [
  "propertyIds",
  "categories",
  "types",
  "statuses",
  "operationIds",
];
const fail = (message) => {
  throw new Error(message);
};
export function normalizeExportOptions(state, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Les critères d’export sont invalides.");
  const startDate = clean(input.startDate),
    endDate = clean(input.endDate);
  if (!validDate(startDate) || !validDate(endDate))
    fail("Choisissez des dates de début et de fin valides.");
  if (startDate > endDate)
    fail("La date de fin doit suivre ou égaler la date de début.");
  const dateBasis = input.dateBasis ?? "payments";
  if (!DATE_BASES.includes(dateBasis))
    fail("Choisissez le type de date utilisé pour l’export.");
  const allowed = {
    propertyIds: new Set(["", ...state.properties.map((p) => p.id)]),
    categories: new Set(CATEGORIES.map((c) => c.id)),
    types: new Set(TYPES),
    statuses: new Set(STATUSES),
    operationIds: new Set(state.transactions.map((t) => t.id)),
  };
  const options = { startDate, endDate, dateBasis };
  for (const key of optionArrays) {
    if (key === "operationIds" && input[key] === undefined) continue;
    const values = input[key] ?? [];
    if (
      !Array.isArray(values) ||
      values.length > 20000 ||
      values.some((v) => typeof v !== "string" || !allowed[key].has(v))
    )
      fail(`Le filtre « ${key} » contient une valeur inconnue.`);
    options[key] = [...new Set(values)];
  }
  for (const key of ["includeDocuments", "includeFullPaymentHistory", "includeLeaseDocuments"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      fail("Les options de contenu de l’export sont invalides.");
    options[key] = input[key] ?? key === "includeDocuments";
  }
  if (input.query !== undefined && typeof input.query !== "string")
    fail("La recherche de l’export est invalide.");
  options.query = clean(input.query);
  if (options.query.length > 300)
    fail("La recherche doit contenir 300 caractères maximum.");
  return options;
}
export function parisToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(
    new Date(),
  );
}
export function exportSelection(state, input, { today = parisToday() } = {}) {
  const options = normalizeExportOptions(state, input);
  const inRange = (date) =>
    date >= options.startDate && date <= options.endDate;
  const needle = fold(options.query);
  const propertiesById = new Map(state.properties.map((p) => [p.id, p]));
  const selectedOperationIds = options.operationIds
    ? new Set(options.operationIds)
    : null;
  const transactions = state.transactions
    .filter((t) => {
      if (selectedOperationIds && !selectedOperationIds.has(t.id)) return false;
      if (
        options.propertyIds.length &&
        !options.propertyIds.includes(t.propertyId)
      )
        return false;
      if (options.categories.length && !options.categories.includes(t.category))
        return false;
      if (options.types.length && !options.types.includes(t.type)) return false;
      if (
        options.statuses.length &&
        !options.statuses.includes(transactionStatus(t, today))
      )
        return false;
      const p = propertiesById.get(t.propertyId);
      if (
        needle &&
        !fold(
          `${transactionLabel(t, state)} ${t.detail || ""} ${t.notes || ""} ${t.reference || ""} ${t.counterparty || ""} ${p?.name || ""} ${p?.address || ""} ${p?.tenant || ""}`,
        ).includes(needle)
      )
        return false;
      if (options.dateBasis === "payments")
        return getPayments(t).some((p) => inRange(p.date));
      const due = t.dueDate || t.occurrenceDate || t.date;
      if (options.dateBasis === "due") return inRange(due);
      const period = t.period || due.slice(0, 7);
      return (
        period >= options.startDate.slice(0, 7) &&
        period <= options.endDate.slice(0, 7)
      );
    })
    .sort(
      (a, b) =>
        (a.dueDate || a.date).localeCompare(b.dueDate || b.date) ||
        a.id.localeCompare(b.id),
    );
  const payments = transactions
    .flatMap((t) =>
      getPayments(t)
        .filter(
          (p) =>
            options.dateBasis !== "payments" ||
            options.includeFullPaymentHistory ||
            inRange(p.date),
        )
        .map((p) => ({ transactionId: t.id, ...p, inRange: inRange(p.date) })),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.transactionId.localeCompare(b.transactionId) ||
        a.id.localeCompare(b.id),
    );
  const summary = {
    operationCount: transactions.length,
    paymentCount: payments.length,
    periodIncomeCents: 0,
    periodExpenseCents: 0,
  };
  const transactionsById = new Map(transactions.map((t) => [t.id, t]));
  for (const payment of payments) {
    if (!payment.inRange) continue;
    const transaction = transactionsById.get(payment.transactionId);
    summary[
      transaction.type === "income" ? "periodIncomeCents" : "periodExpenseCents"
    ] += payment.amountCents;
  }
  return { options, transactions, payments, summary };
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const makeAccountantCSV = (rows) =>
  "\ufeff" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
const statusName = (today) => (t) =>
  ({
    paid: "Réglée",
    partial: "Partiellement réglée",
    pending: "Prévue",
    overdue: "En retard",
  })[transactionStatus(t, today)];
export function accountantCSVs(
  state,
  selection,
  { documents = [], leaseDocuments = [], attachmentCounts, today = parisToday() } = {},
) {
  const { transactions, payments } = selection;
  const status = statusName(today);
  const transactionsById = new Map(transactions.map((t) => [t.id, t]));
  const propertiesById = new Map(state.properties.map((p) => [p.id, p]));
  const suppliersById = new Map((state.suppliers || []).map((s) => [s.id, s]));
  const leasesById = new Map((state.leases || []).map((l) => [l.id, l]));
  const tenantsById = new Map((state.tenants || []).map((t) => [t.id, t]));
  const leasePaths = new Map();
  for (const doc of leaseDocuments) {
    if (!leasePaths.has(doc.leaseId)) leasePaths.set(doc.leaseId, []);
    if (doc.path) leasePaths.get(doc.leaseId).push(doc.path);
  }
  const rangedTotals = new Map();
  for (const p of payments) {
    if (p.inRange)
      rangedTotals.set(
        p.transactionId,
        (rangedTotals.get(p.transactionId) || 0) + p.amountCents,
      );
  }
  const documentsByTransaction = new Map();
  const documentCounts = new Map();
  for (const doc of documents) {
    documentCounts.set(
      doc.transactionId,
      (documentCounts.get(doc.transactionId) || 0) + 1,
    );
    if (!doc.path) continue;
    if (!documentsByTransaction.has(doc.transactionId))
      documentsByTransaction.set(doc.transactionId, []);
    documentsByTransaction.get(doc.transactionId).push(doc);
  }
  const operations = [
    [
      "ID opération",
      "Libellé",
      "Détail",
      "Type",
      "ID bien",
      "Nom court du bien",
      "Adresse du bien",
      "Locataire",
      "Catégorie",
      "Code catégorie",
      "Période concernée",
      "Date opération",
      "Échéance initiale",
      "Montant attendu EUR",
      "Loyer attendu EUR",
      "Provisions attendues EUR",
      "Capital de prêt attendu EUR",
      "Intérêts de prêt attendus EUR",
      "Assurance emprunteur attendue EUR",
      "Total réglé historique EUR",
      "Reste à régler EUR",
      "Statut à la date de l’export",
      "Tiers",
      "Référence de pièce",
      "Notes",
      "ID périodicité",
      "Date occurrence",
      "Nombre de règlements historiques",
      "Encaissements dans la plage EUR",
      "Décaissements dans la plage EUR",
      "ID fournisseur",
      "Fournisseur (fiche actuelle)",
      "Raison sociale fournisseur",
      "SIRET fournisseur",
      "Adresse fournisseur",
      "E-mail fournisseur",
      "Téléphone fournisseur",
      "Référence client ou contrat fournisseur",
      "ID locataire",
      "ID location",
      "Début de location",
      "Fin de location",
      "Baux et avenants inclus",
      "Justificatif requis",
      "Nombre de justificatifs enregistrés",
      "Justificatif manquant",
      "Justificatifs inclus",
      "Libellé automatique",
    ],
  ];
  for (const t of transactions) {
    const p = propertiesById.get(t.propertyId);
    const ranged = rangedTotals.get(t.id) || 0;
    const supplier = suppliersById.get(t.supplierId);
    const lease = leasesById.get(t.leaseId);
    const files = documentsByTransaction.get(t.id) || [];
    // null means unavailable (demo); omitted means metadata supplied by the ZIP.
    const count = attachmentCounts === null
      ? null
      : (attachmentCounts ?? documentCounts).get(t.id) || 0;
    operations.push([
      t.id,
      transactionLabel(t, state),
      t.detail || "",
      t.type === "income" ? "Encaissement" : "Décaissement",
      t.propertyId || "",
      p?.name || "SCI / Général",
      p?.address || "",
      t.tenantId || ["rent", "recoverable"].includes(t.category) ? t.counterparty || "" : "",
      categoryFor(t.category)?.label || t.category,
      t.category,
      t.period || (t.dueDate || t.date).slice(0, 7),
      t.date,
      t.dueDate || t.occurrenceDate || t.date,
      moneyInput(t.amountCents),
      moneyInput(t.category === "rent" ? (t.rentCents ?? t.amountCents) : 0),
      moneyInput(t.category === "rent" ? (t.chargesCents ?? 0) : 0),
      t.category === "loan_payment" ? moneyInput(t.capitalCents) : "",
      t.category === "loan_payment" ? moneyInput(t.interestCents) : "",
      t.category === "loan_payment" ? moneyInput(t.insuranceCents) : "",
      moneyInput(paidCents(t)),
      moneyInput(remainingCents(t)),
      status(t),
      t.counterparty || "",
      t.reference || "",
      t.notes || "",
      t.recurrenceId || "",
      t.occurrenceDate || "",
      getPayments(t).length,
      t.type === "income" ? moneyInput(ranged) : "",
      t.type === "expense" ? moneyInput(ranged) : "",
      t.supplierId || "",
      supplier?.name || "",
      supplier?.legalName || "",
      supplier?.siret || "",
      supplier?.address || "",
      supplier?.email || "",
      supplier?.phone || "",
      supplier?.reference || "",
      t.tenantId || "",
      t.leaseId || "",
      lease?.startDate || "",
      lease?.endDate || "",
      (leasePaths.get(t.leaseId) || []).join("\n"),
      t.documentNotRequired ? "Non" : "Oui",
      count ?? "",
      t.documentNotRequired ? "Non" : count === null ? "" : count ? "Non" : "Oui",
      files.map((f) => f.path).join("\n"),
      t.normalizedLabel ? "Oui" : "Non",
    ]);
  }
  const settlements = [
    [
      "ID règlement",
      "ID opération",
      "Libellé opération",
      "Date réelle du règlement",
      "Type",
      "Montant réglé EUR",
      "Loyer réglé EUR",
      "Provisions réglées EUR",
      "Encaissement EUR",
      "Décaissement EUR",
      "Dans la plage de dates",
      "ID bien",
      "Nom court du bien",
      "Catégorie",
      "Période concernée",
      "Échéance initiale",
    ],
  ];
  for (const p of payments) {
    const t = transactionsById.get(p.transactionId);
    const property = propertiesById.get(t.propertyId);
    settlements.push([
      p.id,
      t.id,
      transactionLabel(t, state),
      p.date,
      t.type === "income" ? "Encaissement" : "Décaissement",
      moneyInput(p.amountCents),
      moneyInput(p.rentCents ?? 0),
      moneyInput(p.chargesCents ?? 0),
      t.type === "income" ? moneyInput(p.amountCents) : "",
      t.type === "expense" ? moneyInput(p.amountCents) : "",
      p.inRange ? "Oui" : "Non",
      t.propertyId || "",
      property?.name || "SCI / Général",
      categoryFor(t.category)?.label || t.category,
      t.period || (t.dueDate || t.date).slice(0, 7),
      t.dueDate || t.occurrenceDate || t.date,
    ]);
  }
  const properties = [
    [
      "ID bien",
      "Nom court",
      "Adresse",
      "Locataire",
      "Loyer mensuel de référence HC EUR",
      "Provisions mensuelles de référence EUR",
      "Archivé",
    ],
  ];
  const propertyIds = new Set(transactions.map((t) => t.propertyId));
  for (const p of state.properties.filter((p) => propertyIds.has(p.id))) {
    const propertyLeases = (state.leases || []).filter(l => l.propertyId === p.id);
    const activeLease = propertyLeases.find(l => l.startDate <= today && (!l.endDate || l.endDate >= today));
    const currentTenant = propertyLeases.length ? tenantsById.get(activeLease?.tenantId)?.name || "" : p.tenant;
    properties.push([
      p.id,
      p.name,
      p.address,
      currentTenant,
      moneyInput(p.rentCents),
      moneyInput(p.chargesCents),
      p.archived ? "Oui" : "Non",
    ]);
  }
  return {
    "operations.csv": makeAccountantCSV(operations),
    "reglements.csv": makeAccountantCSV(settlements),
    "biens.csv": makeAccountantCSV(properties),
  };
}
