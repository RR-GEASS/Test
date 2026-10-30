import { clean, fold, getPayments, uid, validDate } from "./model.js";

const MAX_LINES = 20000;
const MAX_IMPORTS = 500;
const MAX_CENTS = 1_000_000_000_00;
const fail = message => { throw new Error(message); };
const isRecord = value => value && typeof value === "object" && !Array.isArray(value);
const cents = value => Number.isSafeInteger(value) && Math.abs(value) <= MAX_CENTS;
const identifier = (value, max = 180) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const pairKey = (transactionId, paymentId) => JSON.stringify([transactionId, paymentId]);

function collection(raw, key, maximum) {
  const list = raw[key] === undefined ? [] : raw[key];
  if (!Array.isArray(list) || list.length > maximum)
    fail(`La liste « ${key} » est invalide ou dépasse ${maximum} éléments.`);
  return list;
}
function normalizeRow(input) {
  if (!isRecord(input) || !validDate(input.date) ||
      (input.valueDate !== undefined && input.valueDate !== "" && !validDate(input.valueDate)) ||
      typeof input.label !== "string" || !clean(input.label) || clean(input.label).length > 1000 ||
      !cents(input.amountCents) || input.amountCents === 0 ||
      (input.reference !== undefined && (typeof input.reference !== "string" || clean(input.reference).length > 300)) ||
      !Number.isSafeInteger(input.sourceLineNumber) || input.sourceLineNumber < 1)
    fail("Une ligne bancaire comporte une date, un libellé, un montant ou un numéro de ligne invalide.");
  return {
    date: input.date, valueDate: input.valueDate || "", label: clean(input.label),
    amountCents: input.amountCents, reference: clean(input.reference), sourceLineNumber: input.sourceLineNumber,
  };
}

/** Restore only validated, account-local links; older version-1 backups omit
 * these collections and simply start without imported bank transactions. */
export function validateBankState(raw, state) {
  if (!isRecord(raw)) fail("Les données bancaires sont invalides.");
  const bankImports = [], bankLines = [], bankMatches = [];
  const imports = new Set(), lines = new Map(), matchIds = new Set(), matchedLines = new Set();
  for (const item of collection(raw, "bankImports", MAX_IMPORTS)) {
    if (!isRecord(item) || !identifier(item.id) || imports.has(item.id) ||
        typeof item.name !== "string" || !clean(item.name) || clean(item.name).length > 255 ||
        !timestamp(item.importedAt))
      fail("Un import bancaire est invalide ou dupliqué.");
    imports.add(item.id);
    bankImports.push({ id: item.id, name: clean(item.name), importedAt: item.importedAt });
  }
  for (const item of collection(raw, "bankLines", MAX_LINES)) {
    if (!isRecord(item) || !identifier(item.id) || lines.has(item.id) || !imports.has(item.importId))
      fail("Une ligne bancaire est dupliquée ou son import est introuvable.");
    const value = { id: item.id, importId: item.importId, ...normalizeRow(item) };
    lines.set(value.id, value);
    bankLines.push(value);
  }
  const payments = new Map();
  for (const operation of state.transactions || []) {
    if (operation.cancelledAt) continue;
    for (const payment of getPayments(operation))
      payments.set(pairKey(operation.id, payment.id), { operation, payment });
  }
  const allocated = new Map();
  for (const item of collection(raw, "bankMatches", MAX_LINES)) {
    const line = lines.get(item?.bankLineId);
    if (!isRecord(item) || !identifier(item.id) || matchIds.has(item.id) || !line ||
        matchedLines.has(item.bankLineId) || !timestamp(item.validatedAt) ||
        !Array.isArray(item.allocations) || !item.allocations.length || item.allocations.length > 1000)
      fail("Un rapprochement bancaire est invalide, dupliqué ou sa ligne est introuvable.");
    const allocations = [], pairs = new Set();
    let total = 0;
    for (const allocation of item.allocations) {
      if (!isRecord(allocation) || !identifier(allocation.transactionId) || !identifier(allocation.paymentId) ||
          !cents(allocation.amountCents) || allocation.amountCents <= 0)
        fail("Un montant ou un règlement du rapprochement est invalide.");
      const key = pairKey(allocation.transactionId, allocation.paymentId);
      const target = payments.get(key);
      if (!target)
        fail("Défaites le rapprochement bancaire avant de supprimer, modifier ou annuler le règlement lié.");
      if (pairs.has(key)) fail("Un même règlement est présent deux fois dans ce rapprochement.");
      if ((line.amountCents > 0 ? "income" : "expense") !== target.operation.type)
        fail("Le sens du mouvement bancaire ne correspond pas à celui de l’opération.");
      const cumulative = (allocated.get(key) || 0) + allocation.amountCents;
      if (cumulative > target.payment.amountCents)
        fail("Ce règlement est déjà rapproché, en totalité ou en partie : le montant disponible est dépassé.");
      pairs.add(key);
      allocated.set(key, cumulative);
      total += allocation.amountCents;
      allocations.push({ transactionId: allocation.transactionId, paymentId: allocation.paymentId, amountCents: allocation.amountCents });
    }
    if (total !== Math.abs(line.amountCents))
      fail("Le total des règlements sélectionnés doit correspondre exactement au montant de la ligne bancaire.");
    matchIds.add(item.id);
    matchedLines.add(item.bankLineId);
    bankMatches.push({ id: item.id, bankLineId: item.bankLineId, allocations, validatedAt: item.validatedAt });
  }
  return { bankImports, bankLines, bankMatches };
}

// A multiset preserves two truly identical rows within one bank export. On a
// later overlapping export, only occurrences already imported are omitted.
const signature = row => JSON.stringify([
  row.date, row.valueDate || "", row.amountCents,
  fold(row.label).replace(/\s+/g, " ").trim(), fold(row.reference || "").replace(/\s+/g, " ").trim(),
]);
export function previewBankImport(state, rows) {
  if (!Array.isArray(rows) || rows.length > MAX_LINES)
    fail("Importez au maximum 20 000 lignes bancaires à la fois.");
  const existing = new Map();
  for (const row of state.bankLines || []) {
    const key = signature(row);
    existing.set(key, (existing.get(key) || 0) + 1);
  }
  const newRows = [], duplicateRows = [];
  for (const input of rows) {
    const row = normalizeRow(input), key = signature(row), available = existing.get(key) || 0;
    if (available > 0) {
      existing.set(key, available - 1);
      duplicateRows.push(row);
    } else newRows.push(row);
  }
  return { newRows, duplicateRows };
}
export function importBankRows(state, rows, { fileName = "Export bancaire.csv", allowDuplicates = false } = {}) {
  if (typeof fileName !== "string" || !clean(fileName) || clean(fileName).length > 255 || typeof allowDuplicates !== "boolean")
    fail("Le nom du fichier bancaire ou l’option de doublons est invalide.");
  const preview = previewBankImport(state, rows);
  const selected = allowDuplicates ? rows.map(normalizeRow) : preview.newRows;
  if (!selected.length) return { added: 0, duplicates: preview.duplicateRows.length, importId: null };
  if ((state.bankImports || []).length >= MAX_IMPORTS || (state.bankLines || []).length + selected.length > MAX_LINES)
    fail("La capacité bancaire est atteinte : 500 imports et 20 000 lignes maximum.");
  const importId = uid();
  const next = {
    ...state,
    bankImports: [...(state.bankImports || []), { id: importId, name: clean(fileName), importedAt: new Date().toISOString() }],
    bankLines: [...(state.bankLines || []), ...selected.map(row => ({ id: uid(), importId, ...row }))],
  };
  Object.assign(state, validateBankState(next, state));
  return { added: selected.length, duplicates: allowDuplicates ? 0 : preview.duplicateRows.length, importId };
}
export function availablePaymentCents(state, transactionId, paymentId) {
  const operation = (state.transactions || []).find(row => row.id === transactionId);
  if (!operation || operation.cancelledAt) return 0;
  const payment = getPayments(operation).find(row => row.id === paymentId);
  if (!payment) return 0;
  let allocated = 0;
  for (const match of state.bankMatches || [])
    for (const row of match.allocations)
      if (row.transactionId === transactionId && row.paymentId === paymentId) allocated += row.amountCents;
  return Math.max(0, payment.amountCents - allocated);
}
export function bankLineStatus(state, bankLineId) {
  return (state.bankMatches || []).some(row => row.bankLineId === bankLineId) ? "matched" : "unmatched";
}
export function suggestBankMatches(state, bankLineId, { toleranceDays = 7 } = {}) {
  if (!Number.isInteger(toleranceDays) || toleranceDays < 0 || toleranceDays > 365)
    fail("La tolérance doit être comprise entre 0 et 365 jours.");
  const line = (state.bankLines || []).find(row => row.id === bankLineId);
  if (!line || bankLineStatus(state, bankLineId) === "matched") return [];
  const candidates = [], target = Math.abs(line.amountCents);
  const allocated = new Map();
  for (const match of state.bankMatches || [])
    for (const row of match.allocations) {
      const key = pairKey(row.transactionId, row.paymentId);
      allocated.set(key, (allocated.get(key) || 0) + row.amountCents);
    }
  const direction = line.amountCents > 0 ? "income" : "expense";
  for (const operation of state.transactions || []) {
    if (operation.cancelledAt || operation.type !== direction) continue;
    for (const payment of getPayments(operation)) {
      const available = Math.max(0, payment.amountCents - (allocated.get(pairKey(operation.id, payment.id)) || 0));
      const distanceDays = Math.abs(Date.parse(`${line.date}T00:00:00Z`) - Date.parse(`${payment.date}T00:00:00Z`)) / 86400000;
      if (available !== target || distanceDays > toleranceDays) continue;
      candidates.push({ transactionId: operation.id, paymentId: payment.id, amountCents: available,
        date: payment.date, distanceDays, exactAmount: true, score: 1000 - distanceDays });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.transactionId.localeCompare(b.transactionId) || a.paymentId.localeCompare(b.paymentId));
}
export function validateBankLineMatch(state, bankLineId, allocations) {
  if (!(state.bankLines || []).some(row => row.id === bankLineId)) fail("Cette ligne bancaire est introuvable.");
  if (bankLineStatus(state, bankLineId) === "matched") fail("Cette ligne est déjà rapprochée. Défaites d’abord son rapprochement.");
  const match = { id: uid(), bankLineId, allocations, validatedAt: new Date().toISOString() };
  const next = { ...state, bankMatches: [...(state.bankMatches || []), match] };
  const validated = validateBankState(next, state);
  state.bankMatches = validated.bankMatches;
  return state.bankMatches.at(-1);
}
export function unmatchBankLine(state, bankLineId) {
  const previous = (state.bankMatches || []).length;
  state.bankMatches = (state.bankMatches || []).filter(row => row.bankLineId !== bankLineId);
  return previous !== state.bankMatches.length;
}
export function removeBankImport(state, importId) {
  if (!(state.bankImports || []).some(item => item.id === importId)) fail("Cet import bancaire est introuvable.");
  const lines = new Set((state.bankLines || []).filter(line => line.importId === importId).map(line => line.id));
  if ((state.bankMatches || []).some(match => lines.has(match.bankLineId)))
    fail("Défaites les rapprochements de cet import avant de le supprimer. Les règlements saisis seront conservés.");
  state.bankLines = (state.bankLines || []).filter(line => !lines.has(line.id));
  state.bankImports = (state.bankImports || []).filter(item => item.id !== importId);
  return { removed: lines.size, importId };
}
export function assertNoBankMatch(state, { transactionId, paymentId } = {}) {
  if ((state.bankMatches || []).some(match => match.allocations.some(row => row.transactionId === transactionId &&
      (paymentId === undefined || row.paymentId === paymentId))))
    fail("Défaites d’abord le rapprochement bancaire de ce règlement avant de le modifier ou de l’annuler.");
}
