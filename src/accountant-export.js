import {
  CATEGORIES,
  categoryFor,
  clean,
  fold,
  getPayments,
  leaseRentAt,
  moneyInput,
  paidCents,
  remainingCents,
  transactionLabel,
  transactionStatus,
  validDate,
} from "./model.js";

const DATE_BASES = ["payments", "due", "period", "annual"];
const STATUSES = ["paid", "partial", "pending", "overdue", "cancelled"];
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
  for (const key of ["includeDocuments", "includeFullPaymentHistory", "includeLeaseDocuments", "includeCancelled", "includeBankReconciliation"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      fail("Les options de contenu de l’export sont invalides.");
    options[key] = input[key] ?? ["includeDocuments", "includeBankReconciliation"].includes(key);
  }
  if (input.query !== undefined && typeof input.query !== "string")
    fail("La recherche de l’export est invalide.");
  options.query = clean(input.query);
  if (options.query.length > 300)
    fail("La recherche doit contenir 300 caractères maximum.");
  return options;
}
export function annualAccountantOptions(year) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999)
    fail("Choisissez une année valide pour le dossier comptable.");
  return {
    startDate: `${year}-01-01`, endDate: `${year}-12-31`, dateBasis: "annual",
    propertyIds: [], categories: [], types: [], statuses: [], query: "",
    includeDocuments: true, includeFullPaymentHistory: true,
    includeLeaseDocuments: false, includeCancelled: false,
    includeBankReconciliation: true,
  };
}
const preservedPayments = (t) => Array.isArray(t.payments) ? t.payments
  : t.status === "paid" ? [{ date: t.date, amountCents: t.amountCents }] : [];
const matchesStatus = (t, statuses, today) => !statuses.length ||
  statuses.includes(transactionStatus(t, today)) ||
  (!t.cancelledAt && statuses.includes("overdue") && remainingCents(t) > 0 && (t.dueDate || t.occurrenceDate || t.date) < today);

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
      if (t.cancelledAt && !options.includeCancelled) return false;
      if (selectedOperationIds && !selectedOperationIds.has(t.id)) return false;
      if (
        options.propertyIds.length &&
        !options.propertyIds.includes(t.propertyId)
      )
        return false;
      if (options.categories.length && !options.categories.includes(t.category))
        return false;
      if (options.types.length && !options.types.includes(t.type)) return false;
      if (!matchesStatus(t, options.statuses, today)) return false;
      const p = propertiesById.get(t.propertyId);
      if (
        needle &&
        !fold(
          `${transactionLabel(t, state)} ${t.detail || ""} ${t.notes || ""} ${t.reference || ""} ${t.counterparty || ""} ${p?.name || ""} ${p?.address || ""} ${p?.tenant || ""}`,
        ).includes(needle)
      )
        return false;
      const datePayments = t.cancelledAt ? preservedPayments(t) : getPayments(t);
      if (options.dateBasis === "payments")
        return datePayments.some((p) => inRange(p.date));
      const due = t.dueDate || t.occurrenceDate || t.date;
      if (options.dateBasis === "due") return inRange(due);
      const period = t.period || due.slice(0, 7);
      const periodInRange = period >= options.startDate.slice(0, 7) && period <= options.endDate.slice(0, 7);
      if (options.dateBasis === "annual")
        return inRange(due) || periodInRange || datePayments.some((p) => inRange(p.date));
      return periodInRange;
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
    cancelled: "Annulée",
  })[transactionStatus(t, today)];
export function accountantTables(
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
      "Date d’annulation",
      "Motif d’annulation",
      "Règlements conservés avant annulation EUR",
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
      t.cancelledAt || "",
      t.cancellationReason || "",
      t.cancelledAt ? moneyInput(preservedPayments(t).reduce((sum, p) => sum + p.amountCents, 0)) : "",
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
  const bankLinksByPayment = selection.options.includeBankReconciliation ? bankLinksIndex(state) : new Map();
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
      "Statut du rapprochement bancaire",
      "Montant rapproché EUR",
      "Reste à rapprocher EUR",
      "IDs des lignes bancaires",
      "Dates bancaires",
      "Références bancaires",
      "Fichiers importés et lignes sources",
      "Dates de validation bancaire",
      "Lignes bancaires hors plage",
    ],
  ];
  for (const p of payments) {
    const t = transactionsById.get(p.transactionId);
    const property = propertiesById.get(t.propertyId);
    const bankLinks = bankLinksByPayment.get(JSON.stringify([t.id, p.id])) || [];
    const linkedCents = bankLinks.reduce((sum, link) => sum + link.allocation.amountCents, 0);
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
      !selection.options.includeBankReconciliation ? "Non inclus" : linkedCents === p.amountCents ? "Rapproché" : linkedCents ? "Partiellement rapproché" : "À rapprocher",
      selection.options.includeBankReconciliation ? moneyInput(linkedCents) : "",
      selection.options.includeBankReconciliation ? moneyInput(p.amountCents - linkedCents) : "",
      bankLinks.map(link => link.line.id).join("\n"),
      bankLinks.map(link => link.line.date).join("\n"),
      bankLinks.map(link => link.line.reference || "").join("\n"),
      bankLinks.map(link => `${link.importName} · ligne ${link.line.sourceLineNumber}`).join("\n"),
      bankLinks.map(link => link.match.validatedAt).join("\n"),
      bankLinks.filter(link => link.line.date < selection.options.startDate || link.line.date > selection.options.endDate)
        .map(link => link.line.id).join("\n"),
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
    const currentRent = activeLease ? leaseRentAt(activeLease, today) : p;
    properties.push([
      p.id,
      p.name,
      p.address,
      currentTenant,
      moneyInput(currentRent.rentCents),
      moneyInput(currentRent.chargesCents),
      p.archived ? "Oui" : "Non",
    ]);
  }
  return { operations, settlements, properties, bank: bankReconciliationTable(state, selection, { today }).rows };
}

/** The same raw tables feed CSV and XLSX, so their contents cannot drift. */
export function accountantCSVs(state, selection, details = {}) {
  const tables = details.tables || accountantTables(state, selection, details);
  return {
    "operations.csv": makeAccountantCSV(tables.operations),
    "reglements.csv": makeAccountantCSV(tables.settlements),
    "biens.csv": makeAccountantCSV(tables.properties),
    ...(selection.options.includeBankReconciliation && (state.bankLines || []).length
      ? { "rapprochement-bancaire.csv": makeAccountantCSV(tables.bank) } : {}),
  };
}

export function accountantWorkbookSheets(tables) {
  const numericAmounts = rows => rows.map((row, index) => index ? row.map((value, column) =>
    rows[0][column]?.endsWith(" EUR") && typeof value === "string" && /^-?\d+,\d{2}$/.test(value)
      ? Number(value.replace(",", ".")) : value) : row);
  return [
    { name: "Opérations", rows: numericAmounts(tables.operations) },
    { name: "Règlements", rows: numericAmounts(tables.settlements) },
    { name: "Rapprochement bancaire", rows: numericAmounts(tables.bank) },
    { name: "Biens", rows: numericAmounts(tables.properties) },
  ];
}

function bankLinksIndex(state) {
  const lines = new Map((state.bankLines || []).map(line => [line.id, line]));
  const imports = new Map((state.bankImports || []).map(item => [item.id, item.name]));
  const result = new Map();
  for (const match of state.bankMatches || []) {
    const line = lines.get(match.bankLineId);
    if (!line) continue;
    for (const allocation of match.allocations) {
      const key = JSON.stringify([allocation.transactionId, allocation.paymentId]);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push({ line, match, allocation, importName: imports.get(line.importId) || "" });
    }
  }
  for (const links of result.values()) links.sort((left, right) => left.line.date.localeCompare(right.line.date) || left.line.id.localeCompare(right.line.id));
  return result;
}

/** Bank dates choose statement lines; business filters choose linked details.
 * Unassigned lines remain explicit because their property/category is unknown.
 * Debit/credit are written once per bank line, even with several allocations. */
export function bankReconciliationTable(state, selection, { today = parisToday() } = {}) {
  const headers = [
    "ID ligne bancaire", "Date bancaire", "Date de valeur", "Libellé bancaire",
    "Débit bancaire EUR", "Crédit bancaire EUR", "Référence bancaire", "Fichier importé", "Ligne source",
    "Statut du rapprochement", "Montant bancaire affecté à la sélection EUR", "Montant bancaire hors sélection EUR",
    "Montant restant à rapprocher EUR", "ID opération", "Libellé opération", "Nom court du bien", "Tiers", "Catégorie",
    "ID règlement", "Date réelle du règlement", "Montant total du règlement (repère, ne pas sommer) EUR",
    "Montant rapproché EUR", "Règlement dans la plage de dates", "Opération dans la sélection datée", "Validé le",
  ];
  const rows = [headers];
  const summary = { lineCount: 0, matchedLineCount: 0, unmatchedLineCount: 0, partialSelectionLineCount: 0,
    periodIncomeCents: 0, periodExpenseCents: 0, outsideSelectionCents: 0 };
  const { options } = selection;
  if (!options.includeBankReconciliation) return { rows, summary };
  const inRange = date => date >= options.startDate && date <= options.endDate;
  const matchingOperations = new Map(exportSelection(state, { ...options,
    startDate: "1000-01-01", endDate: "9999-12-31", dateBasis: "annual",
  }, { today }).transactions.map(operation => [operation.id, operation]));
  const selectedDatedIds = new Set(selection.transactions.map(operation => operation.id));
  const matchingPayments = new Map([...matchingOperations].map(([id, operation]) => [id,
    new Map(getPayments(operation).map(payment => [payment.id, payment]))]));
  const imports = new Map((state.bankImports || []).map(item => [item.id, item.name]));
  const matches = new Map((state.bankMatches || []).map(match => [match.bankLineId, match]));
  const properties = new Map(state.properties.map(property => [property.id, property]));
  const lines = (state.bankLines || []).filter(line => inRange(line.date) &&
    (!options.types.length || options.types.includes(line.amountCents > 0 ? "income" : "expense")))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const line of lines) {
    const match = matches.get(line.id);
    const allocations = (match?.allocations || []).filter(item => matchingOperations.has(item.transactionId));
    if (match && !allocations.length) continue;
    const selectedCents = allocations.reduce((sum, item) => sum + item.amountCents, 0);
    const outsideCents = match ? Math.abs(line.amountCents) - selectedCents : 0;
    summary.lineCount++;
    summary[match ? "matchedLineCount" : "unmatchedLineCount"]++;
    if (outsideCents) summary.partialSelectionLineCount++;
    summary.outsideSelectionCents += outsideCents;
    summary[line.amountCents > 0 ? "periodIncomeCents" : "periodExpenseCents"] += Math.abs(line.amountCents);
    const status = !match ? "À rapprocher — Non attribué" : outsideCents ? "Rapprochée — une partie hors sélection" : "Rapprochée";
    const displayedAllocations = allocations.length ? allocations : [null];
    displayedAllocations.forEach((allocation, index) => {
      const operation = allocation ? matchingOperations.get(allocation.transactionId) : null;
      const payment = operation ? matchingPayments.get(operation.id).get(allocation.paymentId) : null;
      rows.push([
        line.id, line.date, line.valueDate || "", line.label,
        index ? "" : line.amountCents < 0 ? moneyInput(-line.amountCents) : "",
        index ? "" : line.amountCents > 0 ? moneyInput(line.amountCents) : "",
        line.reference || "", imports.get(line.importId) || "", line.sourceLineNumber,
        status, index ? "" : moneyInput(selectedCents), index ? "" : moneyInput(outsideCents),
        index ? "" : moneyInput(match ? 0 : Math.abs(line.amountCents)),
        operation?.id || "", operation ? transactionLabel(operation, state) : "",
        operation ? properties.get(operation.propertyId)?.name || "SCI / Général" : "Non attribué",
        operation?.counterparty || "", operation ? categoryFor(operation.category)?.label || operation.category : "",
        payment?.id || "", payment?.date || "", payment ? moneyInput(payment.amountCents) : "",
        allocation ? moneyInput(allocation.amountCents) : "", payment ? inRange(payment.date) ? "Oui" : "Non — hors plage" : "",
        operation ? selectedDatedIds.has(operation.id) ? "Oui" : "Non — hors sélection datée" : "", match?.validatedAt || "",
      ]);
    });
  }
  return { rows, summary };
}
