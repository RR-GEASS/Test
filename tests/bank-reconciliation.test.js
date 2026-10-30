import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyState, parseBackup, serializeBackup, cancelTransaction, getPayments } from "../src/model.js";
import {
  validateBankState, previewBankImport, importBankRows, suggestBankMatches,
  validateBankLineMatch, unmatchBankLine, removeBankImport, availablePaymentCents, bankLineStatus, assertNoBankMatch,
} from "../src/bank-reconciliation.js";

const row = (overrides = {}) => ({ date: "2026-10-05", valueDate: "2026-10-06", label: "VIREMENT LOYER",
  amountCents: 75000, reference: "BANQUE-123", sourceLineNumber: 2, ...overrides });
function operation(id, amountCents, { date = "2026-10-05", type = "income", paid = true, legacy = false } = {}) {
  return { id, date, dueDate: date, type, status: paid ? "paid" : "pending", label: `Opération ${id}`,
    category: type === "income" ? "other_income" : "other_expense", propertyId: "", amountCents,
    counterparty: "Tiers", reference: "", notes: "",
    ...(!legacy ? { payments: paid ? [{ id: `pay-${id}`, date, amountCents, rentCents: 0, chargesCents: 0 }] : [] } : {}),
  };
}
function allocation(id, amountCents) { return { transactionId: id, paymentId: `pay-${id}`, amountCents }; }
function imported(rows = [row()]) {
  const state = createEmptyState();
  importBankRows(state, rows, { fileName: "Caisse-épargne.csv" });
  return state;
}

test("les anciennes sauvegardes sans import bancaire restent lisibles", () => {
  const old = createEmptyState();
  delete old.bankImports; delete old.bankLines; delete old.bankMatches;
  const restored = parseBackup(serializeBackup(old));
  assert.deepEqual(restored.bankImports, []);
  assert.deepEqual(restored.bankLines, []);
  assert.deepEqual(restored.bankMatches, []);
});

test("les lignes bancaires signées et leurs origines survivent à la sauvegarde", () => {
  const state = imported([row(), row({ amountCents: -3250, label: "ASSURANCE", reference: "", sourceLineNumber: 3 })]);
  assert.equal(state.transactions.length, 0, "Importer ne crée aucun paiement ni aucune opération");
  const restored = parseBackup(serializeBackup(state));
  assert.deepEqual(restored.bankLines.map(line => line.amountCents), [75000, -3250]);
  assert.equal(restored.bankImports[0].name, "Caisse-épargne.csv");
  assert.equal(restored.bankLines[1].sourceLineNumber, 3);
  assert.equal(restored.bankLines[0].importId, restored.bankImports[0].id);
});

test("le dédoublonnage est un multiensemble et conserve les mouvements identiques légitimes", () => {
  const repeated = [row(), row({ sourceLineNumber: 3 })];
  const state = imported(repeated);
  assert.equal(state.bankLines.length, 2);
  const before = structuredClone(state);
  const replay = importBankRows(state, [...repeated].reverse(), { fileName: "autre-export.csv" });
  assert.deepEqual(replay, { added: 0, duplicates: 2, importId: null });
  assert.deepEqual(state, before);
  const preview = previewBankImport(state, [...repeated, row({ sourceLineNumber: 4 })]);
  assert.equal(preview.newRows.length, 1);
  assert.equal(preview.duplicateRows.length, 2);
  assert.equal(importBankRows(state, [...repeated, row({ sourceLineNumber: 4 })]).added, 1);
  assert.equal(state.bankLines.length, 3);
});

test("les imports partiels et une référence réutilisée distinguent dates et montants", () => {
  const state = imported([row(), row({ date: "2026-10-06", sourceLineNumber: 3 })]);
  assert.equal(importBankRows(state, [row({ date: "2026-10-06" })]).duplicates, 1);
  const result = importBankRows(state, [row({ amountCents: 76000 }), row({ date: "2026-10-07" })]);
  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 0);
  assert.equal(state.bankLines.length, 4);
  assert.equal(importBankRows(state, [row()], { allowDuplicates: true }).added, 1);
  assert.equal(state.bankLines.length, 5);
});

test("un import invalide ne modifie pas l’état et les capacités sont contrôlées", () => {
  const state = createEmptyState(), before = structuredClone(state);
  for (const invalid of [
    { amountCents: 0 }, { amountCents: 12.5 }, { amountCents: Infinity }, { amountCents: 100_000_000_001 },
    { date: "2026-02-30" }, { valueDate: "2026-13-01" }, { label: " " },
    { sourceLineNumber: 0 }, { sourceLineNumber: "2" }, { reference: 123 },
  ]) {
    assert.throws(() => importBankRows(state, [row(), row(invalid)]));
    assert.deepEqual(state, before);
  }
  assert.throws(() => importBankRows(state, [row()], { fileName: "" }));
  assert.throws(() => importBankRows(state, [row()], { allowDuplicates: "oui" }));
  assert.throws(() => previewBankImport(state, new Array(20001).fill(row())), /20 000/);
  state.bankImports = Array.from({ length: 500 }, (_, id) => ({ id: `import-${id}`, name: "test.csv", importedAt: "2026-10-01T10:00:00.000Z" }));
  assert.throws(() => importBankRows(state, [row()]), /500 imports/);
});

test("les suggestions croisent montant disponible, sens et dates sans valider automatiquement", () => {
  const state = imported();
  state.transactions = [
    operation("same", 75000), operation("other-day", 75000, { date: "2026-10-07" }),
    operation("wrong-amount", 75100), operation("wrong-direction", 75000, { type: "expense" }),
    operation("too-far", 75000, { date: "2026-09-01" }), operation("unpaid", 75000, { paid: false }),
  ];
  const candidates = suggestBankMatches(state, state.bankLines[0].id);
  assert.deepEqual(candidates.map(candidate => candidate.transactionId), ["same", "other-day"]);
  assert.equal(candidates[0].distanceDays, 0);
  assert.equal(candidates[1].distanceDays, 2);
  assert.equal(candidates.every(candidate => candidate.exactAmount), true);
  assert.deepEqual(state.bankMatches, [], "Même une correspondance exacte reste à confirmer");
  assert.deepEqual(suggestBankMatches(state, "absent"), []);
  assert.throws(() => suggestBankMatches(state, state.bankLines[0].id, { toleranceDays: -1 }));
});

test("deux candidats identiques restent tous deux proposés et le calcul de jours ignore l’heure d’été", () => {
  const state = imported([row({ date: "2026-03-29" })]);
  state.transactions = [operation("a", 75000, { date: "2026-03-28" }), operation("b", 75000, { date: "2026-03-28" })];
  const candidates = suggestBankMatches(state, state.bankLines[0].id, { toleranceDays: 1 });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].score, candidates[1].score);
  assert.equal(candidates[0].distanceDays, 1);
  assert.deepEqual(state.bankMatches, []);
});

test("un virement peut relier plusieurs paiements et un paiement peut être couvert par plusieurs virements", () => {
  const state = imported([row({ amountCents: 6000 }), row({ amountCents: 4000, sourceLineNumber: 3 })]);
  state.transactions = [operation("a", 8000), operation("b", 2000)];
  const [first, second] = state.bankLines;
  validateBankLineMatch(state, first.id, [allocation("a", 4000), allocation("b", 2000)]);
  assert.equal(availablePaymentCents(state, "a", "pay-a"), 4000);
  assert.equal(availablePaymentCents(state, "b", "pay-b"), 0);
  assert.equal(bankLineStatus(state, first.id), "matched");
  assert.equal(bankLineStatus(state, second.id), "unmatched");
  assert.deepEqual(suggestBankMatches(state, second.id).map(candidate => candidate.transactionId), ["a"]);
  validateBankLineMatch(state, second.id, [allocation("a", 4000)]);
  assert.equal(availablePaymentCents(state, "a", "pay-a"), 0);
  assert.deepEqual(parseBackup(serializeBackup(state)).bankMatches, state.bankMatches);
  assert.equal(unmatchBankLine(state, first.id), true);
  assert.equal(availablePaymentCents(state, "a", "pay-a"), 4000);
  assert.equal(availablePaymentCents(state, "b", "pay-b"), 2000);
  assert.equal(unmatchBankLine(state, first.id), false);
});

test("le total exact et les plafonds des règlements empêchent un rapprochement en trop", () => {
  const state = imported([row({ amountCents: 6000 }), row({ amountCents: 6000, sourceLineNumber: 3 })]);
  state.transactions = [operation("a", 10000)];
  const [first, second] = state.bankLines;
  assert.throws(() => validateBankLineMatch(state, first.id, [allocation("a", 5000)]), /exactement/);
  assert.deepEqual(state.bankMatches, []);
  validateBankLineMatch(state, first.id, [allocation("a", 6000)]);
  const before = structuredClone(state.bankMatches);
  assert.throws(() => validateBankLineMatch(state, second.id, [allocation("a", 6000)]), /disponible/);
  assert.deepEqual(state.bankMatches, before);
  assert.throws(() => validateBankLineMatch(state, first.id, [allocation("a", 6000)]), /déjà rapprochée/);
});

test("les liens sans paiement réel, de mauvais sens ou dupliqués sont refusés", () => {
  const state = imported();
  state.transactions = [operation("a", 75000), operation("expense", 75000, { type: "expense" }), operation("unpaid", 75000, { paid: false })];
  const id = state.bankLines[0].id;
  assert.throws(() => validateBankLineMatch(state, id, [allocation("expense", 75000)]), /sens/);
  assert.throws(() => validateBankLineMatch(state, id, [allocation("unpaid", 75000)]), /règlement lié/);
  assert.throws(() => validateBankLineMatch(state, id, [allocation("missing", 75000)]), /règlement lié/);
  assert.throws(() => validateBankLineMatch(state, id, [allocation("a", 37500), allocation("a", 37500)]), /deux fois/);
  assert.throws(() => validateBankLineMatch(state, id, [allocation("a", -75000)]), /montant/i);
  assert.deepEqual(state.bankMatches, []);
});

test("les références bancaires ne permettent pas de lier une opération annulée ou un paiement supprimé", () => {
  const state = imported();
  state.transactions = [operation("a", 75000)];
  validateBankLineMatch(state, state.bankLines[0].id, [allocation("a", 75000)]);
  assert.throws(() => cancelTransaction(state, "a", "Correction", "2026-10-10"), /rapprochement/);
  assert.throws(() => assertNoBankMatch(state, { transactionId: "a", paymentId: "pay-a" }), /rapprochement/);
  assert.doesNotThrow(() => assertNoBankMatch(state, { transactionId: "a", paymentId: "autre" }));
  const removedPayment = structuredClone(state);
  removedPayment.transactions[0].payments = [];
  assert.throws(() => parseBackup(serializeBackup(removedPayment)), /Défaites le rapprochement/);
  const cancelled = structuredClone(state);
  cancelled.transactions[0].cancelledAt = "2026-10-10";
  cancelled.transactions[0].cancellationReason = "Correction";
  assert.throws(() => parseBackup(serializeBackup(cancelled)), /Défaites le rapprochement/);
  unmatchBankLine(state, state.bankLines[0].id);
  assert.doesNotThrow(() => cancelTransaction(state, "a", "Correction", "2026-10-10"));
});

test("un ancien paiement synthétique conserve son identifiant stable au rechargement", () => {
  const state = imported();
  state.transactions = [operation("legacy", 75000, { legacy: true })];
  const paymentId = getPayments(state.transactions[0])[0].id;
  assert.equal(paymentId, "legacy:legacy");
  validateBankLineMatch(state, state.bankLines[0].id, [{ transactionId: "legacy", paymentId, amountCents: 75000 }]);
  const restored = parseBackup(serializeBackup(state));
  assert.equal(restored.bankMatches[0].allocations[0].paymentId, paymentId);
  assert.equal(availablePaymentCents(restored, "legacy", paymentId), 0);
});

test("un import erroné sans rapprochement se supprime sans retirer les autres lignes ni les paiements", () => {
  const state = imported([row(), row({ sourceLineNumber: 3 })]);
  const firstImport = state.bankImports[0].id;
  importBankRows(state, [row({ date: "2026-10-09" })], { fileName: "conserver.csv" });
  state.transactions = [operation("a", 75000)];
  const previousPayments = structuredClone(state.transactions);
  const result = removeBankImport(state, firstImport);
  assert.deepEqual(result, { removed: 2, importId: firstImport });
  assert.equal(state.bankImports.length, 1);
  assert.equal(state.bankImports[0].name, "conserver.csv");
  assert.equal(state.bankLines.length, 1);
  assert.equal(state.bankLines[0].date, "2026-10-09");
  assert.deepEqual(state.transactions, previousPayments);
  assert.doesNotThrow(() => parseBackup(serializeBackup(state)));
  assert.throws(() => removeBankImport(state, firstImport), /introuvable/);
});

test("un import rapproché reste conservé jusqu’à la suppression explicite de ses liens", () => {
  const state = imported();
  state.transactions = [operation("a", 75000)];
  const importId = state.bankImports[0].id, lineId = state.bankLines[0].id;
  validateBankLineMatch(state, lineId, [allocation("a", 75000)]);
  const before = structuredClone(state);
  assert.throws(() => removeBankImport(state, importId), /rapprochements/);
  assert.deepEqual(state, before);
  unmatchBankLine(state, lineId);
  assert.equal(removeBankImport(state, importId).removed, 1);
  assert.equal(state.bankLines.length, 0);
  assert.equal(state.bankImports.length, 0);
  assert.equal(state.transactions[0].payments[0].amountCents, 75000);
});

test("les imports, lignes et rapprochements falsifiés sont rejetés à la restauration", () => {
  const state = imported();
  state.transactions = [operation("a", 75000)];
  validateBankLineMatch(state, state.bankLines[0].id, [allocation("a", 75000)]);
  for (const change of [
    draft => { draft.bankImports = null; },
    draft => { draft.bankImports[0].importedAt = "2026-02-30T00:00:00.000Z"; },
    draft => { draft.bankImports.push({ ...draft.bankImports[0] }); },
    draft => { draft.bankLines[0].importId = "other-account-import"; },
    draft => { draft.bankLines.push({ ...draft.bankLines[0] }); },
    draft => { draft.bankMatches[0].bankLineId = "other-account-line"; },
    draft => { draft.bankMatches.push({ ...draft.bankMatches[0], id: "second-match" }); },
    draft => { draft.bankMatches[0].validatedAt = "demain"; },
    draft => { draft.bankMatches[0].allocations[0].amountCents = 74999; },
  ]) {
    const draft = structuredClone(state);
    change(draft);
    assert.throws(() => parseBackup(serializeBackup(draft)));
  }
  assert.deepEqual(validateBankState({}, state), { bankImports: [], bankLines: [], bankMatches: [] });
});
