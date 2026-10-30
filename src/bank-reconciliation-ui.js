import { getPayments, money, moneyInput, parseMoney, shortDate, transactionLabel, fold, uid } from "./model.js";
import { esc, icon } from "./ui.js";
import { decodeBankCSV, inspectBankCSV, parseBankCSV } from "./bank-csv.js";
import {
  previewBankImport, importBankRows, suggestBankMatches, validateBankLineMatch,
  unmatchBankLine, removeBankImport,
} from "./bank-reconciliation.js";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const mappingFields = [
  ["date", "Date de l’opération"], ["label", "Libellé bancaire"],
  ["amount", "Montant signé"], ["debit", "Débit"], ["credit", "Crédit"],
  ["valueDate", "Date de valeur"], ["reference", "Référence bancaire"],
];
const paymentKey = (transactionId, paymentId) => JSON.stringify([transactionId, paymentId]);
const matchFor = (state, lineId) => (state.bankMatches || []).find(match => match.bankLineId === lineId);
const importedFile = (state, line, imports) => (imports ? imports.get(line.importId) : (state.bankImports || []).find(item => item.id === line.importId))?.name || "Import bancaire";
const sourceHTML = (state, line, imports) => `<small>${esc(importedFile(state, line, imports))} · ligne ${line.sourceLineNumber}${line.reference ? ` · ${esc(line.reference)}` : ""}</small>`;

export function createBankReconciliationUI(ctx) {
  const { getState, allowMutation, mountDialog, closeDialog, formHeader, formFooter, saveDialog } = ctx;
  const filters = { month: "", status: "all", query: "" };
  let activeContent, pageNumber = 1, ownerKey;

  function bind(container) {
    container.querySelectorAll("[data-bank-action]").forEach(button => button.addEventListener("click", () =>
      action(button.dataset.bankAction, button.dataset.id, button.closest("dialog")),
    ));
  }
  function refresh() {
    if (activeContent?.isConnected) render(activeContent);
  }
  function render(content) {
    activeContent = content;
    const currentOwner = ctx.getUser()?.ownerId || ctx.getUser()?.id || "demo";
    if (ownerKey !== currentOwner) { ownerKey = currentOwner; Object.assign(filters, { month: "", status: "all", query: "" }); pageNumber = 1; }
    const state = getState();
    const lines = [...(state.bankLines || [])].sort((a, b) => b.date.localeCompare(a.date) || a.sourceLineNumber - b.sourceLineNumber);
    const matches = new Map((state.bankMatches || []).map(match => [match.bankLineId, match]));
    const imports = new Map((state.bankImports || []).map(item => [item.id, item]));
    const operations = new Map(state.transactions.map(operation => [operation.id, operation]));
    const importCounts = new Map();
    for (const line of lines) {
      const count = importCounts.get(line.importId) || { lines: 0, matched: 0 };
      count.lines++;
      if (matches.has(line.id)) count.matched++;
      importCounts.set(line.importId, count);
    }
    const matched = matches.size;
    content.innerHTML = `<div class="notice bank-reconciliation-note">${icon("wallet")}<span><strong>Importez, comparez, puis validez.</strong> Les lignes bancaires ne créent aucun règlement et ne changent pas votre trésorerie. Le rapprochement relie un mouvement du compte à un ou plusieurs règlements déjà saisis.</span></div>
      <div class="bank-reconciliation-stats"><div class="stat-card"><span>Lignes importées</span><strong data-testid="bank-line-count">${lines.length}</strong></div><div class="stat-card"><span>Rapprochées</span><strong data-testid="bank-matched-count">${matched}</strong></div><div class="stat-card"><span>À rapprocher</span><strong data-testid="bank-unmatched-count">${lines.length - matched}</strong></div></div>
      <section class="panel bank-reconciliation-panel"><div class="panel-heading"><div><h2>Mouvements du compte bancaire</h2><p>Les suggestions comparent le sens, le montant et la date. Chaque lien est validé par vous.</p></div><button type="button" class="button secondary" data-bank-action="bank-import">${icon("upload")}Importer un CSV</button></div>
      <div class="bank-reconciliation-filters"><div class="form-field"><label for="bank-filter-month">Mois du relevé</label><input id="bank-filter-month" type="month" value="${esc(filters.month)}"></div><div class="form-field"><label for="bank-filter-status">Statut du rapprochement</label><select id="bank-filter-status"><option value="all">Tous les mouvements</option><option value="unmatched" ${filters.status === "unmatched" ? "selected" : ""}>À rapprocher</option><option value="matched" ${filters.status === "matched" ? "selected" : ""}>Rapprochés</option></select></div><div class="form-field bank-filter-search"><label for="bank-filter-query">Rechercher un mouvement bancaire</label><input id="bank-filter-query" type="search" placeholder="Libellé, référence, fichier…" value="${esc(filters.query)}"></div><button type="button" class="text-link" data-bank-reset>Réinitialiser</button></div>
      <div data-bank-results></div></section><div class="bank-reconciliation-bottom"><p class="form-note">Une opération « Réglée » indique qu’un paiement a été saisi. « Rapproché » signifie que vous avez vérifié sa correspondance avec un mouvement importé. Un règlement peut couvrir plusieurs échéances, ou être retrouvé sur plusieurs mouvements bancaires.</p><button type="button" class="text-link" data-bank-pointing>Ouvrir le pointage mensuel</button></div>${imports.size ? `<details class="panel bank-import-history"><summary>Imports effectués (${imports.size})</summary><p class="form-note">Un mauvais fichier peut être supprimé puis réimporté avec les bonnes colonnes. Défaites d’abord les rapprochements de ses lignes.</p><ul class="payment-list">${[...imports.values()].reverse().map(item => {
        const count = importCounts.get(item.id) || { lines: 0, matched: 0 };
        return `<li data-testid="bank-import-record"><span><strong>${esc(item.name)}</strong><small>${shortDate(item.importedAt.slice(0, 10))} · ${count.lines} ligne(s) · ${count.matched} rapprochée(s)</small></span><button type="button" class="text-link danger-text" data-bank-action="remove-bank-import" data-id="${esc(item.id)}" ${count.matched ? 'disabled title="Défaites les rapprochements de cet import avant de le supprimer."' : ""}>Supprimer cet import</button></li>`;
      }).join("")}</ul></details>` : ""}`;
    function updateRows() {
      const needle = fold(filters.query);
      const shown = lines.filter(line => (!filters.month || line.date.startsWith(filters.month)) &&
        (filters.status === "all" || (matches.has(line.id) ? "matched" : "unmatched") === filters.status) &&
        (!needle || fold(`${line.label} ${line.reference || ""} ${importedFile(state, line, imports)}`).includes(needle)));
      const pageCount = Math.max(1, Math.ceil(shown.length / 50));
      pageNumber = Math.min(pageNumber, pageCount);
      const target = content.querySelector("[data-bank-results]");
      target.innerHTML = shown.length ? `<div class="table-scroll finance-scroll" tabindex="0" role="region" aria-label="Mouvements bancaires à rapprocher"><table class="ledger bank-lines-table"><thead><tr><th>Date</th><th>Mouvement bancaire</th><th>Montant</th><th>Rapprochement</th><th>Action</th></tr></thead><tbody>${shown.slice((pageNumber - 1) * 50, pageNumber * 50).map(line => {
        const match = matches.get(line.id);
        const details = match ? match.allocations.map(allocation => {
          const operation = operations.get(allocation.transactionId);
          return `<small>${esc(operation ? transactionLabel(operation, state) : allocation.transactionId)} · ${money(allocation.amountCents)}</small>`;
        }).join("") : "";
        return `<tr data-testid="bank-line-row" data-bank-line-id="${esc(line.id)}"><td>${shortDate(line.date)}${line.valueDate ? `<small>Valeur : ${shortDate(line.valueDate)}</small>` : ""}</td><td class="bank-line-label"><strong>${esc(line.label)}</strong>${sourceHTML(state, line, imports)}</td><td class="amount ${line.amountCents > 0 ? "income" : "expense"}">${money(line.amountCents)}</td><td><span class="status-pill ${match ? "paid" : "pending"}">${match ? "Rapproché" : "À rapprocher"}</span>${details}</td><td><button type="button" class="text-link" data-bank-action="${match ? "view-bank-match" : "match-bank-line"}" data-id="${esc(line.id)}">${match ? "Voir le rapprochement" : "Rapprocher"}</button></td></tr>`;
      }).join("")}</tbody></table></div><div class="bank-results-pagination"><span>${shown.length} mouvement${shown.length > 1 ? "s" : ""} · Page ${pageNumber} / ${pageCount}</span><div><button type="button" class="text-link" data-bank-page="previous" ${pageNumber === 1 ? "disabled" : ""}>Précédente</button><button type="button" class="text-link" data-bank-page="next" ${pageNumber === pageCount ? "disabled" : ""}>Suivante</button></div></div>` : `<div class="empty-state">${icon("receipt")}<h3>${lines.length ? "Aucun mouvement pour ces filtres" : "Votre premier import bancaire"}</h3><p>${lines.length ? "Changez le mois, le statut ou la recherche." : "Téléchargez les opérations du compte SCI au format CSV depuis votre banque, puis vérifiez les colonnes dans l’aperçu."}</p>${lines.length ? "" : '<button type="button" class="button secondary" data-bank-action="bank-import">Importer un CSV</button>'}</div>`;
      bind(target);
      target.querySelectorAll("[data-bank-page]").forEach(button => button.addEventListener("click", () => { pageNumber += button.dataset.bankPage === "next" ? 1 : -1; updateRows(); }));
    }
    for (const [selector, key] of [["#bank-filter-month", "month"], ["#bank-filter-status", "status"], ["#bank-filter-query", "query"]]) {
      content.querySelector(selector).addEventListener(key === "query" ? "input" : "change", event => { filters[key] = event.target.value; pageNumber = 1; updateRows(); });
    }
    content.querySelector("[data-bank-reset]").addEventListener("click", () => { Object.assign(filters, { month: "", status: "all", query: "" }); pageNumber = 1; refresh(); });
    content.querySelector("[data-bank-pointing]").addEventListener("click", () => ctx.navigate("pointing"));
    bind(content);
    updateRows();
  }

  function importForm() {
    if (!allowMutation()) return;
    const previewState = structuredClone(getState());
    const prefix = `bank-import-${uid()}`;
    const d = mountDialog(`<dialog class="form-dialog bank-import-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Importer un relevé bancaire CSV", "Vérifiez les colonnes et l’aperçu avant d’ajouter les mouvements.", "upload")}
      <ol class="bank-import-steps"><li>Téléchargez les opérations du compte SCI au format CSV.</li><li>Vérifiez la date, le libellé et les montants détectés ci-dessous.</li><li>Importez les lignes, puis validez leurs correspondances avec vos règlements.</li></ol><p class="form-note">Les colonnes proposées conviennent aux exports bancaires courants, dont les variantes françaises. Le format de la Caisse d’Épargne peut varier : l’aperçu fait foi. Un fichier Excel ou un PDF doit d’abord être exporté en CSV depuis la banque.</p>
      <div class="form-field"><label for="${prefix}-file">Fichier CSV bancaire</label><input id="${prefix}-file" name="bankFile" type="file" accept=".csv,text/csv,text/plain"><p class="form-note">2 Mo maximum · un seul compte bancaire SCI suivi dans cette application. L’import conserve les mouvements et leur fichier d’origine indiqué, pas le fichier CSV lui-même.</p></div>
      <details class="bank-import-options"><summary>Lecture du fichier et colonnes</summary><div class="bank-import-controls"><div class="form-field"><label for="${prefix}-encoding">Encodage du fichier</label><select id="${prefix}-encoding" data-import-encoding><option value="auto">Détection automatique</option><option value="utf-8">UTF-8</option><option value="windows-1252">Windows / accents français</option></select></div><div class="form-field"><label for="${prefix}-delimiter">Séparateur des colonnes</label><select id="${prefix}-delimiter" data-import-delimiter><option value="auto">Détection automatique</option><option value=";">Point-virgule ;</option><option value=",">Virgule ,</option><option value="tab">Tabulation</option></select></div><div class="form-field"><label for="${prefix}-header">Ligne des en-têtes</label><input id="${prefix}-header" data-import-header type="number" min="1" step="1" placeholder="Automatique"></div><div class="form-field"><label for="${prefix}-mode">Présentation des montants</label><select id="${prefix}-mode" data-import-mode><option value="auto">Détection automatique</option><option value="signed">Une colonne de montant signé</option><option value="split">Deux colonnes Débit / Crédit</option></select></div></div><p class="form-note" data-import-detection>Choisissez un fichier pour reconnaître ses colonnes.</p><div class="bank-mapping-grid" data-import-mapping></div></details>
      <div data-import-feedback role="status" aria-live="polite"></div><div data-import-errors class="finance-error" role="alert"></div><div data-import-preview></div><label class="check-label bank-duplicates-choice"><input type="checkbox" name="allowDuplicates" data-import-duplicates>Importer aussi les mouvements déjà présents ou semblables</label><p class="form-note">Par défaut, les doublons possibles sont écartés. Vérifiez cette option seulement si les mouvements semblables sont réellement distincts. Plusieurs mouvements identiques dans un même fichier sont conservés selon leur nombre.</p>${formFooter("Importer les lignes")}</form></dialog>`);
    const form = d.querySelector("form");
    const submit = form.querySelector('[type="submit"]');
    const errorTarget = d.querySelector("[data-import-errors]");
    const feedback = d.querySelector("[data-import-feedback]");
    const preview = d.querySelector("[data-import-preview]");
    const allowDuplicates = d.querySelector("[data-import-duplicates]");
    let bytes, fileName = "", inspection, parsed, reading = false, fileRequest = 0;
    submit.disabled = true;
    function settings() {
      const rawHeader = d.querySelector("[data-import-header]").value;
      const selectedDelimiter = d.querySelector("[data-import-delimiter]").value;
      return { delimiter: selectedDelimiter === "tab" ? "\t" : selectedDelimiter, headerRow: rawHeader ? Number(rawHeader) : "auto", amountMode: d.querySelector("[data-import-mode]").value };
    }
    function currentMapping() {
      return Object.fromEntries([...d.querySelectorAll("[data-bank-column]")].map(select => [select.dataset.bankColumn, Number(select.value)]));
    }
    function drawMapping() {
      const selected = inspection.mapping || {};
      d.querySelector("[data-import-mapping]").innerHTML = mappingFields.map(([key, label]) => `<div class="form-field" data-mapping-field="${key}"><label for="${prefix}-map-${key}">${label}</label><select id="${prefix}-map-${key}" data-bank-column="${key}"><option value="-1">Non utilisée / à choisir</option>${inspection.headers.map((header, index) => `<option value="${index}" ${selected[key] === index ? "selected" : ""}>${index + 1} · ${esc(header || "Colonne sans titre")}</option>`).join("")}</select></div>`).join("");
      d.querySelectorAll("[data-bank-column]").forEach(select => select.addEventListener("change", () => updatePreview()));
    }
    function updatePreview(reinspect = false) {
      parsed = undefined;
      submit.disabled = true;
      errorTarget.textContent = "";
      if (!bytes || reading) return;
      try {
        const text = decodeBankCSV(bytes, d.querySelector("[data-import-encoding]").value);
        const options = settings();
        if (!inspection || reinspect) {
          inspection = inspectBankCSV(text, options);
          drawMapping();
          const delimiterName = inspection.delimiter === "\t" ? "tabulation" : `« ${inspection.delimiter} »`;
          d.querySelector("[data-import-detection]").textContent = `En-têtes : ligne ${inspection.headerRow} · séparateur ${delimiterName}. Vous pouvez corriger chaque colonne.`;
        }
        const mode = options.amountMode;
        d.querySelectorAll("[data-mapping-field]").forEach(field => {
          const key = field.dataset.mappingField;
          field.hidden = (mode === "signed" && ["debit", "credit"].includes(key)) || (mode === "split" && key === "amount");
        });
        parsed = parseBankCSV(text, { ...options, mapping: currentMapping() });
        const planned = previewBankImport(previewState, parsed.rows);
        const duplicateLines = new Set(planned.duplicateRows.map(row => row.sourceLineNumber));
        const importedCount = allowDuplicates.checked ? parsed.rows.length : planned.newRows.length;
        feedback.textContent = `${parsed.rows.length} ligne(s) lue(s) · ${planned.duplicateRows.length} doublon(s) possible(s) · ${importedCount} ligne(s) à importer.`;
        errorTarget.textContent = (parsed.errors || []).map(error => `${error.sourceLineNumber ? `Ligne ${error.sourceLineNumber} : ` : ""}${error.message}`).join(" ");
        const warnings = parsed.warnings || [];
        preview.innerHTML = `${warnings.length ? `<p class="form-note bank-import-warnings">${warnings.map(esc).join(" ")}</p>` : ""}${parsed.rows.length ? `<div class="table-scroll bank-import-preview" tabindex="0" role="region" aria-label="Aperçu de l’import bancaire"><table class="ledger"><thead><tr><th>Ligne</th><th>Date</th><th>Libellé bancaire</th><th>Montant</th><th>Import</th></tr></thead><tbody>${parsed.rows.slice(0, 50).map(row => `<tr data-testid="bank-import-preview-row"><td>${row.sourceLineNumber}</td><td>${shortDate(row.date)}${row.valueDate ? `<small>Valeur : ${shortDate(row.valueDate)}</small>` : ""}</td><td>${esc(row.label)}${row.reference ? `<small>${esc(row.reference)}</small>` : ""}</td><td class="amount ${row.amountCents > 0 ? "income" : "expense"}">${money(row.amountCents)}</td><td>${duplicateLines.has(row.sourceLineNumber) ? allowDuplicates.checked ? "Semblable · inclus" : "Doublon possible · écarté" : "Nouveau"}</td></tr>`).join("")}</tbody></table></div>${parsed.rows.length > 50 ? `<p class="form-note">Aperçu limité aux 50 premières lignes. ${importedCount} ligne(s) seront importées après validation.</p>` : ""}` : '<p class="form-note">Aucune ligne valide à importer. Vérifiez les colonnes et la ligne des en-têtes.</p>'}`;
        submit.disabled = importedCount === 0 || (parsed.errors || []).length > 0;
        if ((parsed.errors || []).length) d.querySelector(".bank-import-options").open = true;
      } catch (error) {
        errorTarget.textContent = error.message;
        feedback.textContent = "Le fichier doit être vérifié avant l’import.";
        preview.innerHTML = "";
        d.querySelector(".bank-import-options").open = true;
      }
    }
    form.querySelector('[type="file"]').addEventListener("change", async event => {
      const request = ++fileRequest;
      const file = event.target.files?.[0];
      bytes = undefined; inspection = undefined; parsed = undefined; reading = false;
      preview.innerHTML = ""; errorTarget.textContent = ""; submit.disabled = true;
      if (!file) { feedback.textContent = ""; return; }
      if (file.size > MAX_FILE_SIZE) { errorTarget.textContent = "Le fichier dépasse 2 Mo. Choisissez une période plus courte depuis votre banque."; return; }
      if (/\.(?:xlsx?|pdf)$/i.test(file.name)) { errorTarget.textContent = "Choisissez un export CSV de la banque. Les fichiers Excel et PDF ne sont pas lus ici."; return; }
      reading = true; feedback.textContent = "Lecture du CSV…";
      try {
        const buffer = await file.arrayBuffer();
        if (request !== fileRequest || !d.isConnected) return;
        bytes = new Uint8Array(buffer); fileName = file.name;
      } catch (error) { if (request === fileRequest) errorTarget.textContent = `Le fichier n’a pas pu être lu : ${error.message}`; }
      finally { if (request === fileRequest && d.isConnected) { reading = false; if (bytes) updatePreview(true); } }
    });
    for (const selector of ["[data-import-encoding]", "[data-import-delimiter]", "[data-import-header]"]) d.querySelector(selector).addEventListener("change", () => updatePreview(true));
    d.querySelector("[data-import-mode]").addEventListener("change", () => updatePreview());
    allowDuplicates.addEventListener("change", () => updatePreview());
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!parsed || reading || parsed.errors?.length || submit.disabled) return;
      const rows = parsed.rows.map(row => ({ ...row }));
      const duplicates = allowDuplicates.checked;
      let result;
      try {
        await saveDialog(d, () => `${result.added} mouvement(s) bancaire(s) importé(s)${result.duplicates ? ` ; ${result.duplicates} doublon(s) écarté(s)` : ""}. Aucun règlement n’a été créé.`, () => {
          result = importBankRows(getState(), rows, { fileName, allowDuplicates: duplicates });
        }, () => { Object.assign(filters, { month: "", status: "all", query: "" }); pageNumber = 1; refresh(); });
      } catch (error) { errorTarget.textContent = error.message; }
    });
  }

  function matchingForm(lineId) {
    if (!allowMutation()) return;
    const state = getState();
    const line = (state.bankLines || []).find(item => item.id === lineId);
    if (!line) return;
    if (matchFor(state, lineId)) { matchDetails(lineId); return; }
    const direction = line.amountCents > 0 ? "income" : "expense";
    const suggestions = suggestBankMatches(state, lineId, { toleranceDays: 7 });
    const suggestionMap = new Map(suggestions.map(item => [paymentKey(item.transactionId, item.paymentId), item]));
    const allocatedByPayment = new Map();
    for (const match of state.bankMatches || []) for (const allocation of match.allocations) {
      const key = paymentKey(allocation.transactionId, allocation.paymentId);
      allocatedByPayment.set(key, (allocatedByPayment.get(key) || 0) + allocation.amountCents);
    }
    const candidates = [];
    for (const operation of state.transactions) {
      if (operation.cancelledAt || operation.type !== direction) continue;
      for (const payment of getPayments(operation)) {
        const key = paymentKey(operation.id, payment.id);
        const available = payment.amountCents - (allocatedByPayment.get(key) || 0);
        if (available <= 0) continue;
        candidates.push({ key, operation, payment, available, suggestion: suggestionMap.get(key) });
      }
    }
    candidates.sort((a, b) => Number(Boolean(b.suggestion)) - Number(Boolean(a.suggestion)) || (b.suggestion?.score || 0) - (a.suggestion?.score || 0) || b.payment.date.localeCompare(a.payment.date));
    candidates.forEach((candidate, index) => { candidate.index = index; });
    const candidateByKey = new Map(candidates.map(candidate => [candidate.key, candidate]));
    const selected = new Map();
    let candidatePage = 1;
    const prefix = `bank-match-${uid()}`;
    const d = mountDialog(`<dialog class="form-dialog bank-match-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Rapprocher un mouvement bancaire", "Choisissez les règlements correspondants, puis vérifiez le total avant de valider.", "check")}<div class="bank-matching-source"><strong>${esc(line.label)}</strong><span>${shortDate(line.date)} · ${money(line.amountCents)}</span>${sourceHTML(state, line)}</div><p class="form-note">Suggestions : même montant, même sens et date proche (jusqu’à 7 jours). Aucune correspondance n’est sélectionnée automatiquement. Pour un versement groupé ou un règlement fractionné, choisissez plusieurs règlements ou adaptez la part rapprochée.</p><div class="bank-match-controls"><div class="form-field"><label for="${prefix}-query">Rechercher un règlement</label><input id="${prefix}-query" type="search" data-candidate-query placeholder="Opération, tiers, référence…"></div><label class="check-label"><input type="checkbox" data-candidate-all>Afficher tous les règlements disponibles du même sens</label></div><div data-candidate-list></div><div class="bank-match-selection" data-match-selection aria-live="polite"></div><div class="bank-match-total" data-match-total role="status" aria-live="polite"></div><p class="form-note">Le total des parts choisies doit être égal au mouvement bancaire pour pouvoir valider.</p><p class="finance-error" data-match-error role="alert"></p>${formFooter("Valider le rapprochement")}</form></dialog>`);
    const form = d.querySelector("form");
    const submit = form.querySelector('[type="submit"]');
    const errorTarget = d.querySelector("[data-match-error]");
    function allocationValues() {
      return [...selected].map(([key, value]) => {
        const candidate = candidateByKey.get(key);
        return { transactionId: candidate.operation.id, paymentId: candidate.payment.id, amountCents: parseMoney(value) };
      });
    }
    function updateTotal() {
      const allocations = allocationValues();
      const invalid = allocations.some(allocation => {
        const candidate = candidateByKey.get(paymentKey(allocation.transactionId, allocation.paymentId));
        return allocation.amountCents === null || allocation.amountCents <= 0 || allocation.amountCents > candidate.available;
      });
      const total = allocations.reduce((sum, allocation) => sum + (allocation.amountCents || 0), 0);
      const expected = Math.abs(line.amountCents);
      d.querySelector("[data-match-total]").textContent = `À rapprocher : ${money(expected)} · Sélection : ${money(total)} · Écart : ${money(expected - total)}`;
      errorTarget.textContent = invalid ? "Chaque part doit être positive et ne pas dépasser le montant disponible du règlement." : total > expected ? "Le total sélectionné dépasse le mouvement bancaire. Ajustez les parts rapprochées." : "";
      d.querySelector("[data-match-selection]").innerHTML = selected.size ? `<strong>${selected.size} règlement(s) sélectionné(s)</strong><ul>${[...selected].map(([key, value]) => {
        const candidate = candidateByKey.get(key);
        return `<li><span>${esc(transactionLabel(candidate.operation, state))} · ${shortDate(candidate.payment.date)} · ${esc(value)} €</span><button type="button" class="text-link" data-remove-selection="${candidate.index}" aria-label="Retirer ${esc(transactionLabel(candidate.operation, state))}">Retirer</button></li>`;
      }).join("")}</ul>` : "";
      d.querySelectorAll("[data-remove-selection]").forEach(button => button.addEventListener("click", () => { selected.delete(candidates[Number(button.dataset.removeSelection)].key); renderCandidates(); }));
      submit.disabled = allocations.length === 0 || invalid || total !== expected;
    }
    function renderCandidates() {
      const needle = fold(d.querySelector("[data-candidate-query]").value);
      const all = d.querySelector("[data-candidate-all]").checked;
      const visible = candidates.filter(candidate => (all || candidate.suggestion || selected.has(candidate.key)) && (!needle || fold(`${transactionLabel(candidate.operation, state)} ${candidate.operation.counterparty || ""} ${candidate.operation.reference || ""} ${candidate.payment.date}`).includes(needle)));
      const pageCount = Math.max(1, Math.ceil(visible.length / 50));
      candidatePage = Math.min(candidatePage, pageCount);
      const target = d.querySelector("[data-candidate-list]");
      target.innerHTML = visible.length ? `<div class="table-scroll bank-candidate-scroll" tabindex="0" role="region" aria-label="Règlements disponibles pour le rapprochement"><table class="ledger bank-candidate-table"><thead><tr><th>Choisir</th><th>Règlement saisi</th><th>Date</th><th>Disponible</th><th>Part rapprochée (€)</th></tr></thead><tbody>${visible.slice((candidatePage - 1) * 50, candidatePage * 50).map(candidate => {
        const index = candidate.index;
        return `<tr data-testid="bank-candidate-row"><td><input type="checkbox" data-candidate-index="${index}" ${selected.has(candidate.key) ? "checked" : ""} aria-label="Choisir ${esc(transactionLabel(candidate.operation, state))} du ${shortDate(candidate.payment.date)}"></td><td><strong>${esc(transactionLabel(candidate.operation, state))}</strong>${candidate.suggestion ? `<small class="bank-suggestion">Montant identique · ${candidate.suggestion.distanceDays} jour(s) d’écart</small>` : '<small>Choix manuel · vérifiez la correspondance</small>'}</td><td>${shortDate(candidate.payment.date)}</td><td>${money(candidate.available)}</td><td><input type="text" inputmode="decimal" data-candidate-amount="${index}" value="${esc(selected.get(candidate.key) ?? moneyInput(Math.min(candidate.available, Math.abs(line.amountCents))))}" ${selected.has(candidate.key) ? "" : "disabled"} aria-label="Part rapprochée pour ${esc(transactionLabel(candidate.operation, state))} du ${shortDate(candidate.payment.date)}"></td></tr>`;
      }).join("")}</tbody></table></div><div class="bank-results-pagination"><span>${visible.length} règlement(s) · Page ${candidatePage} / ${pageCount}</span><div><button type="button" class="text-link" data-candidate-page="previous" ${candidatePage === 1 ? "disabled" : ""}>Précédente</button><button type="button" class="text-link" data-candidate-page="next" ${candidatePage === pageCount ? "disabled" : ""}>Suivante</button></div></div><p class="form-note">Les sélections restent conservées si vous changez de page ou filtrez la liste.</p>` : `<div class="bank-no-suggestions"><p>${candidates.length ? "Aucune proposition pour cette recherche. Affichez tous les règlements disponibles pour choisir manuellement, notamment pour un versement groupé." : "Aucun règlement disponible du même sens. Enregistrez d’abord le paiement à sa date réelle dans le pointage mensuel, puis revenez ici."}</p>${candidates.length ? '<button type="button" class="text-link" data-show-all-candidates>Afficher tous les règlements</button>' : '<button type="button" class="text-link" data-bank-go-pointing>Fermer et aller au pointage</button>'}</div>`;
      target.querySelectorAll("[data-candidate-page]").forEach(button => button.addEventListener("click", () => { candidatePage += button.dataset.candidatePage === "next" ? 1 : -1; renderCandidates(); }));
      target.querySelector("[data-show-all-candidates]")?.addEventListener("click", () => { d.querySelector("[data-candidate-all]").checked = true; d.querySelector("[data-candidate-query]").value = ""; candidatePage = 1; renderCandidates(); });
      target.querySelector("[data-bank-go-pointing]")?.addEventListener("click", () => { closeDialog(d); ctx.navigate("pointing"); });
      target.querySelectorAll("[data-candidate-index]").forEach(checkbox => checkbox.addEventListener("change", () => {
        const candidate = candidates[Number(checkbox.dataset.candidateIndex)];
        const amount = target.querySelector(`[data-candidate-amount="${checkbox.dataset.candidateIndex}"]`);
        amount.disabled = !checkbox.checked;
        if (checkbox.checked) {
          const already = allocationValues().reduce((sum, allocation) => sum + (allocation.amountCents || 0), 0);
          const remaining = Math.abs(line.amountCents) - already;
          amount.value = moneyInput(Math.min(candidate.available, remaining > 0 ? remaining : Math.abs(line.amountCents)));
          selected.set(candidate.key, amount.value);
        } else selected.delete(candidate.key);
        updateTotal();
      }));
      target.querySelectorAll("[data-candidate-amount]").forEach(input => input.addEventListener("input", () => {
        selected.set(candidates[Number(input.dataset.candidateAmount)].key, input.value);
        updateTotal();
      }));
      updateTotal();
    }
    d.querySelector("[data-candidate-query]").addEventListener("input", () => { candidatePage = 1; renderCandidates(); });
    d.querySelector("[data-candidate-all]").addEventListener("change", () => { candidatePage = 1; renderCandidates(); });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submit.disabled) return;
      const allocations = allocationValues();
      try {
        await saveDialog(d, "Le rapprochement bancaire a été validé.", () => validateBankLineMatch(getState(), line.id, allocations));
      } catch (error) { errorTarget.textContent = error.message; }
    });
    renderCandidates();
  }

  function matchDetails(lineId) {
    const state = getState();
    const line = (state.bankLines || []).find(item => item.id === lineId);
    const match = matchFor(state, lineId);
    if (!line || !match) return;
    const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(match.validatedAt));
    const d = mountDialog(`<dialog class="form-dialog bank-match-dialog" aria-labelledby="dialog-title">${formHeader("Rapprochement validé", "Le mouvement du compte est relié aux règlements ci-dessous.", "check")}<div class="bank-matching-source"><strong>${esc(line.label)}</strong><span>${shortDate(line.date)} · ${money(line.amountCents)}</span>${sourceHTML(state, line)}</div><ul class="payment-list">${match.allocations.map(allocation => {
      const operation = state.transactions.find(item => item.id === allocation.transactionId);
      const payment = operation && getPayments(operation).find(item => item.id === allocation.paymentId);
      return `<li><span>${esc(operation ? transactionLabel(operation, state) : allocation.transactionId)}<small>Règlement du ${shortDate(payment?.date || "")} · Part reliée : ${money(allocation.amountCents)}</small></span></li>`;
    }).join("")}</ul><p class="form-note">Validé le ${esc(when)}. Défaites ce rapprochement avant de corriger ou d’annuler un règlement lié. Cette action conserve les paiements saisis et les mouvements importés.</p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Fermer</button><button type="button" class="button secondary" data-bank-action="unmatch-bank-line" data-id="${esc(lineId)}">Défaire le rapprochement</button></div></dialog>`);
    bind(d);
  }
  function unmatchForm(lineId, sourceDialog) {
    if (!allowMutation()) return;
    const line = (getState().bankLines || []).find(item => item.id === lineId);
    if (!line || !matchFor(getState(), lineId)) return;
    const d = mountDialog(`<dialog class="confirm-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Défaire ce rapprochement ?", `${line.label} · ${money(line.amountCents)}`, "flag")}<p class="form-note">Le mouvement bancaire redeviendra « À rapprocher ». Les règlements et les opérations seront conservés. Cette modification restera dans l’historique.</p><p class="finance-error" role="alert"></p>${formFooter("Défaire le rapprochement")}</form></dialog>`);
    d.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      try { await saveDialog(d, "Le rapprochement a été défait. Les règlements sont conservés.", () => unmatchBankLine(getState(), lineId), () => { if (sourceDialog) closeDialog(sourceDialog); }); }
      catch (error) { d.querySelector(".finance-error").textContent = error.message; }
    });
  }
  function removeImportForm(importId) {
    if (!allowMutation()) return;
    const item = (getState().bankImports || []).find(record => record.id === importId);
    if (!item) return;
    const lineIds = new Set((getState().bankLines || []).filter(line => line.importId === importId).map(line => line.id));
    if ((getState().bankMatches || []).some(match => lineIds.has(match.bankLineId))) {
      ctx.toast("Défaites les rapprochements de cet import avant de le supprimer.", true);
      return;
    }
    const d = mountDialog(`<dialog class="confirm-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Supprimer cet import bancaire ?", item.name, "flag")}<p class="form-note">Les ${lineIds.size} mouvement(s) de cet import seront retirés. Les opérations et leurs règlements restent conservés. Vous pourrez réimporter le fichier avec les bonnes colonnes.</p><p class="finance-error" role="alert"></p>${formFooter("Supprimer l’import")}</form></dialog>`);
    d.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      try { await saveDialog(d, "L’import bancaire a été supprimé. Les opérations et règlements sont conservés.", () => removeBankImport(getState(), importId)); }
      catch (error) { d.querySelector(".finance-error").textContent = error.message; }
    });
  }
  function action(name, id, sourceDialog) {
    if (name === "bank-import") { importForm(); return true; }
    if (name === "match-bank-line") { matchingForm(id); return true; }
    if (name === "view-bank-match") { matchDetails(id); return true; }
    if (name === "unmatch-bank-line") { unmatchForm(id, sourceDialog); return true; }
    if (name === "remove-bank-import") { removeImportForm(id); return true; }
    return false;
  }
  return { render, action };
}
