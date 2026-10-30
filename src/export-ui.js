import {
  CATEGORIES,
  transactionLabel,
  categoryFor,
  money,
  shortDate,
  todayISO,
  remainingCents,
  paidCents,
  transactionStatus,
} from "./model.js";
import { exportSelection, accountantCSVs, normalizeExportOptions, annualAccountantOptions } from "./accountant-export.js";
import { icon, esc } from "./ui.js";
import { api } from "./api.js";
export function createExportUI(ctx) {
  let values = null,
    selectedIds = null,
    ownerKey = null,
    busy = false,
    downloadError = "",
    attachmentCounts = null,
    summaryError = "",
    summaryRequest = 0;
  const dateBasis = [
    { id: "payments", label: "Règlements réels" },
    { id: "due", label: "Échéances des opérations" },
    { id: "period", label: "Période concernée (mois)" },
    { id: "annual", label: "Dossier annuel : échéances, périodes et règlements" },
  ];
  const statusOptions = [
    { id: "paid", label: "Réglées" },
    { id: "partial", label: "Partiellement réglées" },
    { id: "pending", label: "Prévues" },
    { id: "overdue", label: "En retard" },
  ];
  function reset() {
    const y = ctx.getYear();
    values = {
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      dateBasis: "payments",
      propertyIds: [],
      categories: [],
      types: [],
      statuses: [],
      query: "",
      includeDocuments: true,
      includeFullPaymentHistory: false,
      includeLeaseDocuments: false,
      includeCancelled: false,
    };
    try {
      const stored = JSON.parse(localStorage.getItem(`cap-sci.export.${ownerKey}`) || "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const candidate = { ...values, ...stored };
        delete candidate.operationIds;
        const allowed = {
          propertyIds: new Set(["", ...ctx.getState().properties.map(p => p.id)]),
          categories: new Set(CATEGORIES.map(c => c.id)),
          types: new Set(["income", "expense"]),
          statuses: new Set(statusOptions.map(s => s.id)),
        };
        for (const [key, ids] of Object.entries(allowed))
          candidate[key] = Array.isArray(candidate[key]) ? candidate[key].filter(id => ids.has(id)) : [];
        values = normalizeExportOptions(ctx.getState(), candidate);
      }
    } catch { /* Invalid or unavailable preferences fall back to this exercise. */ }
    selectedIds = null;
    attachmentCounts = null;
    summaryError = "";
  }
  function remember() {
    try { localStorage.setItem(`cap-sci.export.${ownerKey}`, JSON.stringify(values)); }
    catch { /* Export stays available if browser storage is disabled. */ }
  }
  async function loadSummary(content) {
    const owner = ctx.getUser()?.id;
    const request = ++summaryRequest;
    attachmentCounts = null;
    summaryError = "";
    if (!owner) return;
    try {
      const result = await api("/attachments/summary");
      if (request !== summaryRequest || ctx.getUser()?.id !== owner || !content.isConnected) return;
      if (!result.counts || typeof result.counts !== "object" || Array.isArray(result.counts) || Object.values(result.counts).some(n => !Number.isSafeInteger(n) || n < 0))
        throw new Error("Le nombre de justificatifs n’a pas pu être vérifié.");
      attachmentCounts = new Map(Object.entries(result.counts));
    } catch (error) {
      if (request !== summaryRequest || ctx.getUser()?.id !== owner || !content.isConnected) return;
      summaryError = error.message;
    }
    preview(content);
  }
  function checkGroup(key, title, items) {
    return `<fieldset class="export-check-group"><legend>${title}</legend><div>${items.map((o) => `<label><input type="checkbox" name="${key}" value="${esc(o.id)}" ${values[key].includes(o.id) ? "checked" : ""}><span>${esc(o.label)}</span></label>`).join("") || '<span class="form-note">Aucun bien enregistré.</span>'}</div><p>Aucune case cochée = tous.</p></fieldset>`;
  }
  function render(content) {
    const owner = ctx.getUser()?.id || "demo";
    if (!values || owner !== ownerKey) {
      ownerKey = owner;
      reset();
    }
    content.innerHTML = `<section class="export-intro"><span class="feature-icon blue">${icon("receipt")}</span><div><h2>Un dossier clair pour votre comptable</h2><p>Choisissez les dates, les opérations et les pièces à transmettre. Le dossier ZIP rassemble les tableaux détaillés et les justificatifs classés par bien, dans Encaissements et Décaissements.</p></div></section><div class="export-layout"><section class="panel export-settings" aria-labelledby="export-settings-title"><div class="panel-heading"><div><h2 id="export-settings-title">Préparer le dossier</h2><p>Les dates de début et de fin sont incluses.</p></div></div><form id="accountant-export-form" novalidate><div class="form-grid">${ctx.field("startDate", "Du", values.startDate, "date", "required")}${ctx.field("endDate", "Au", values.endDate, "date", "required")}</div><div class="export-quick-dates"><button type="button" data-export-range="current">Année en cours</button><button type="button" data-export-range="previous">Année précédente</button><button type="button" data-export-range="month">Mois en cours</button><button type="button" data-export-range="last-month">Mois précédent</button><button type="button" data-export-range="last-quarter">Trimestre précédent</button></div><button type="button" class="button secondary" id="export-annual-preset">${icon("receipt")}Dossier annuel comptable</button><p class="form-note">Prépare l’année indiquée dans « Du », avec les opérations réglées ou non et les règlements de cette année. Les filtres et exclusions manuelles sont remis à zéro.</p>${ctx.selectField("dateBasis", "Dates à utiliser", dateBasis, values.dateBasis)}<p class="form-note" id="export-date-help"></p>${ctx.field("query", "Rechercher dans les opérations", values.query, "search", 'placeholder="Libellé, tiers, référence…" maxlength="300"')}${checkGroup(
      "types",
      "Types",
      [
        { id: "income", label: "Encaissements" },
        { id: "expense", label: "Décaissements" },
      ],
    )}${checkGroup("statuses", "Statuts", statusOptions)}<details class="export-extra"><summary>Filtrer par biens et catégories</summary>${checkGroup("propertyIds", "Biens", [{ id: "", label: "SCI / Général" }, ...ctx.getState().properties.map((p) => ({ id: p.id, label: p.name + (p.archived ? " (archivé)" : "") }))])}${checkGroup("categories", "Catégories", CATEGORIES)}</details><div class="export-document-options"><label class="check-label"><input type="checkbox" name="includeDocuments" ${values.includeDocuments ? "checked" : ""}>Inclure les justificatifs</label><p class="form-note">Les pièces des opérations retenues sont ajoutées au dossier ZIP, avec le libellé de leur opération et leur extension.</p><label class="check-label"><input type="checkbox" name="includeLeaseDocuments" ${values.includeLeaseDocuments ? "checked" : ""}>Inclure les baux et avenants liés</label><p class="form-note">Ajoute uniquement les baux et avenants des locations liées aux opérations retenues. Les documents personnels des locataires restent dans leur fiche.</p><label class="check-label"><input type="checkbox" name="includeFullPaymentHistory" ${values.includeFullPaymentHistory ? "checked" : ""}>Inclure tous les règlements liés</label><p class="form-note">En mode « Règlements réels », ajoute aussi les règlements liés hors dates. Ils sont identifiés « Hors période » et exclus des totaux de la plage choisie.</p><details class="export-extra"><summary>Historique des annulations</summary><label class="check-label"><input type="checkbox" name="includeCancelled" ${values.includeCancelled ? "checked" : ""}>Inclure les opérations annulées</label><p class="form-note">Ajoute leur date et leur motif pour contrôle. Leurs anciens règlements restent hors des mouvements de trésorerie.</p></details></div><p class="finance-error" role="alert" id="export-error"></p></form></section><section class="export-result"><div class="export-metrics"><div class="stat-card"><span>Opérations retenues</span><strong data-testid="export-operation-count">0</strong></div><div class="stat-card"><span>Règlements exportés</span><strong data-testid="export-payment-count">0</strong></div></div><div class="panel export-package"><div class="panel-heading"><h2>Le contenu du dossier</h2><span class="year-chip">ZIP</span></div><ul><li>${icon("receipt")}<span><strong>Opérations et règlements</strong><small>Montants attendus, réglés et restants, ventilation, dates, biens, tiers, références et notes.</small></span></li><li>${icon("building")}<span><strong>Informations des biens</strong><small>Noms courts, adresses, locataires et loyers de référence.</small></span></li><li>${icon("folder")}<span><strong>Justificatifs classés par bien</strong><small>Pour chaque bien, les documents sont rangés directement dans Encaissements ou Décaissements. Les CSV indiquent leur chemin.</small></span></li></ul><div class="export-cash-summary" id="export-cash-summary"></div><div class="notice" id="export-preflight" aria-live="polite"></div><div class="export-downloads"><button class="button primary" id="download-accountant-zip">${icon("download")}Télécharger le dossier ZIP</button><button class="button secondary" id="download-accountant-csv">${icon("download")}Télécharger le CSV des opérations</button></div><p class="form-note export-auth-note">${ctx.getUser() ? "Le ZIP utilise les données enregistrées sur le serveur au moment du téléchargement." : "Connectez-vous pour télécharger un ZIP avec les justificatifs de votre compte. Le CSV permet de découvrir l’export en démonstration."}</p><p class="form-note export-auth-note">Ce dossier prépare les échanges avec votre comptable ; il ne constitue pas un FEC ni une déclaration fiscale.</p></div></section></div><section class="panel export-preview"><div class="panel-heading"><div><h2>Vérifier les opérations à transmettre</h2><p>Décochez les opérations à exclure. Modifier un filtre réinitialise cette sélection.</p></div><label class="check-label"><input type="checkbox" id="export-select-all" checked>Tout inclure</label></div><div id="export-preview-body"></div></section>`;
    const form = content.querySelector("form");
    function read(event) {
      const f = new FormData(form);
      for (const key of ["startDate", "endDate", "dateBasis", "query"])
        values[key] = String(f.get(key) || "");
      for (const key of ["propertyIds", "categories", "types", "statuses"])
        values[key] = f.getAll(key).map(String);
      values.includeDocuments = f.has("includeDocuments");
      values.includeFullPaymentHistory = f.has("includeFullPaymentHistory");
      values.includeLeaseDocuments = f.has("includeLeaseDocuments");
      values.includeCancelled = f.has("includeCancelled");
      if (
        !["includeDocuments", "includeFullPaymentHistory", "includeLeaseDocuments", "includeCancelled"].includes(
          event?.target?.name,
        )
      )
        selectedIds = null;
      downloadError = "";
      remember();
      preview(content);
    }
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    form.addEventListener("submit", (e) => e.preventDefault());
    content.querySelector("#export-annual-preset").addEventListener("click", () => {
      const year = Number(form.elements.startDate.value.slice(0, 4)) || Number(ctx.getYear());
      values = annualAccountantOptions(year);
      selectedIds = null;
      downloadError = "";
      remember();
      render(content);
      ctx.toast(`Dossier ${year} préparé : échéances, périodes et règlements, y compris les opérations non réglées.`);
    });
    content.querySelectorAll("[data-export-range]").forEach((b) =>
      b.addEventListener("click", () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const range = b.dataset.exportRange;
        let start, end;
        if (range === "month" || range === "last-month") {
          const month = m - (range === "last-month" ? 1 : 0);
          start = new Date(y, month, 1);
          end = new Date(y, month + 1, 0);
        } else if (range === "last-quarter") {
          const month = Math.floor(m / 3) * 3;
          start = new Date(y, month - 3, 1);
          end = new Date(y, month, 0);
        } else {
          const year = y - (range === "previous" ? 1 : 0);
          start = new Date(year, 0, 1);
          end = new Date(year, 11, 31);
        }
        form.elements.startDate.value = todayISO(start);
        form.elements.endDate.value = todayISO(end);
        read();
      }),
    );
    content
      .querySelector("#export-select-all")
      .addEventListener("change", (e) => {
        selectedIds = e.target.checked ? null : new Set();
        preview(content);
      });
    content
      .querySelector("#download-accountant-zip")
      .addEventListener("click", () => downloadZip(content));
    content
      .querySelector("#download-accountant-csv")
      .addEventListener("click", () => downloadCSV(content));
    preview(content);
    void loadSummary(content);
  }
  function select(base = false) {
    return exportSelection(ctx.getState(), {
      ...values,
      ...(!base && selectedIds !== null
        ? { operationIds: [...selectedIds] }
        : {}),
    });
  }
  function error(content, message) {
    content.querySelector("#export-error").textContent = message;
  }
  function preview(content) {
    let base, selection;
    const help = {
      payments:
        "Sélection selon les dates effectives des règlements. Pour les opérations sans règlement, choisissez « Échéances ».",
      due: "Sélection selon la date d’échéance de chaque opération. Les règlements liés sont fournis, même hors plage, avec un indicateur de date.",
      period:
        "Sélection par mois concernés : tous les mois du mois de début au mois de fin sont inclus, indépendamment du jour choisi.",
      annual:
        "Inclut les opérations dont l’échéance, la période ou un règlement appartient aux dates choisies, même si elles ne sont pas réglées. Vérifiez aussi les factures non saisies et le rattachement à l’exercice avec votre comptable.",
    };
    content.querySelector("#export-date-help").textContent =
      help[values.dateBasis];
    try {
      base = select(true);
      selection = select();
      error(
        content,
        ctx.isSynced()
          ? downloadError
          : "Des modifications ne sont pas encore enregistrées. Enregistrez-les avant de préparer un dossier comptable.",
      );
    } catch (e) {
      error(content, e.message);
      content.querySelector("#export-preflight").textContent = "Contrôle disponible après correction des filtres.";
      content.querySelector("#export-cash-summary").textContent =
        "Sélection à préciser.";
      content.querySelector("#export-select-all").checked = false;
      content.querySelector("#export-select-all").indeterminate = false;
      content.querySelector("#export-preview-body").innerHTML =
        '<div class="empty-state"><p>Corrigez les paramètres de sélection pour afficher les opérations.</p></div>';
      for (const b of content.querySelectorAll(".export-downloads button"))
        b.disabled = true;
      content.querySelector(
        "[data-testid=export-operation-count]",
      ).textContent = "0";
      content.querySelector("[data-testid=export-payment-count]").textContent =
        "0";
      return;
    }
    content.querySelector("[data-testid=export-operation-count]").textContent =
      selection.summary.operationCount;
    content.querySelector("[data-testid=export-payment-count]").textContent =
      selection.summary.paymentCount;
    content.querySelector("#export-cash-summary").innerHTML =
      `<span>Règlements effectifs du ${shortDate(values.startDate)} au ${shortDate(values.endDate)}</span><div><span>Encaissements <strong>${money(selection.summary.periodIncomeCents)}</strong></span><span>Décaissements <strong>${money(selection.summary.periodExpenseCents)}</strong></span></div>`;
    content.querySelector("#download-accountant-zip").disabled =
      busy ||
      !ctx.getUser() ||
      !selection.transactions.length ||
      !ctx.isSynced();
    content.querySelector("#download-accountant-csv").disabled =
      busy || !selection.transactions.length || !ctx.isSynced();
    const activeTransactions = selection.transactions.filter(t => !t.cancelledAt);
    const missingReferences = activeTransactions.filter(t => !t.reference?.trim()).length;
    const exempt = activeTransactions.filter(t => t.documentNotRequired).length;
    const missingDocuments = attachmentCounts === null ? null : activeTransactions.filter(t => !t.documentNotRequired && !(attachmentCounts.get(t.id) || 0)).length;
    const documentsMessage = missingDocuments !== null
      ? `${missingDocuments} opération(s) sans justificatif · ${exempt} sans pièce requise`
      : !ctx.getUser() ? "Justificatifs non vérifiés en démonstration" : summaryError ? "Justificatifs non vérifiés : " + summaryError : "Vérification des justificatifs…";
    content.querySelector("#export-preflight").textContent = `Avant l’envoi : ${documentsMessage}. ${missingReferences} référence(s) non renseignée(s), à compléter si nécessaire.`;
    const all = content.querySelector("#export-select-all");
    all.checked =
      selectedIds === null ||
      (selection.transactions.length === base.transactions.length &&
        base.transactions.length > 0);
    all.indeterminate =
      selection.transactions.length > 0 &&
      selection.transactions.length < base.transactions.length;
    content.querySelector("#export-preview-body").innerHTML = base.transactions
      .length
      ? `<div class="table-scroll finance-scroll" role="region" tabindex="0" aria-label="Aperçu défilant de l’export"><table class="ledger"><thead><tr><th><span class="sr-only">Inclure</span></th><th>Opération</th><th>Échéance</th><th>Attendu</th><th>Réglé total</th><th>Reste</th></tr></thead><tbody>${base.transactions
          .slice(0, 100)
          .map(
            (t) =>
              `<tr data-testid="export-operation-row"><td><input type="checkbox" data-export-operation="${esc(t.id)}" aria-label="Inclure ${esc(transactionLabel(t, ctx.getState()))}" ${selectedIds === null || selectedIds.has(t.id) ? "checked" : ""}></td><td><strong>${esc(transactionLabel(t, ctx.getState()))}</strong><small>${esc(categoryFor(t.category)?.label || "")} · ${esc({ paid: "Réglée", partial: "Partiellement réglée", pending: "Prévue", overdue: "En retard", cancelled: "Annulée" }[transactionStatus(t)])}</small></td><td>${shortDate(t.dueDate || t.occurrenceDate || t.date)}</td><td>${money(t.amountCents)}</td><td>${money(paidCents(t))}</td><td>${money(remainingCents(t))}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div>${base.transactions.length > 100 ? '<p class="form-note export-auth-note">Seules les 100 premières lignes sont affichées. Le dossier contient toute la sélection ; affinez les filtres pour choisir davantage de lignes individuellement.</p>' : ""}`
      : '<div class="empty-state"><h3>Aucune opération ne correspond aux filtres</h3><p>Vérifiez les dates et le mode de sélection. Les échéances non réglées ne figurent pas dans les règlements réels.</p></div>';
    content.querySelectorAll("[data-export-operation]").forEach((c) =>
      c.addEventListener("change", () => {
        if (selectedIds === null)
          selectedIds = new Set(base.transactions.map((t) => t.id));
        if (c.checked) selectedIds.add(c.dataset.exportOperation);
        else selectedIds.delete(c.dataset.exportOperation);
        preview(content);
      }),
    );
  }
  async function downloadCSV(content) {
    if (busy || !ctx.isSynced()) return;
    try {
      const state = structuredClone(ctx.getState());
      const userId = ctx.getUser()?.id || null;
      const requestOptions = {
        ...structuredClone(values),
        ...(selectedIds !== null ? { operationIds: [...selectedIds] } : {}),
      };
      const selection = exportSelection(state, requestOptions);
      if (!selection.transactions.length) return;
      busy = true;
      downloadError = "";
      preview(content);
      let attachmentCounts = null;
      if (userId) {
        const result = await api("/attachments/summary");
        if (!result.counts || typeof result.counts !== "object" ||
            Array.isArray(result.counts) ||
            Object.values(result.counts).some((n) => !Number.isSafeInteger(n) || n < 0))
          throw new Error("Impossible de vérifier les justificatifs. Réessayez le téléchargement du CSV.");
        attachmentCounts = new Map(Object.entries(result.counts));
        if (ctx.getUser()?.id !== userId)
          throw new Error("Le compte a changé. Relancez l’export depuis le compte souhaité.");
      }
      const files = accountantCSVs(state, selection, { attachmentCounts });
      ctx.download(
        files["operations.csv"],
        `cap-sci-operations-${requestOptions.startDate}-${requestOptions.endDate}.csv`,
        "text/csv;charset=utf-8",
      );
      ctx.toast("Le CSV détaillé a été téléchargé.");
    } catch (e) {
      downloadError = e.message;
      error(content, e.message);
    } finally {
      busy = false;
      preview(content);
    }
  }
  async function downloadZip(content) {
    if (busy || !ctx.getUser() || !ctx.isSynced()) return;
    try {
      const selection = select();
      if (!selection.transactions.length) return;
      const requestOptions = {
        ...values,
        ...(selectedIds !== null ? { operationIds: [...selectedIds] } : {}),
      };
      busy = true;
      downloadError = "";
      preview(content);
      const button = content.querySelector("#download-accountant-zip");
      button.innerHTML = `${icon("clock")}Préparation du dossier…`;
      const response = await fetch("/api/exports/accountant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestOptions),
      });
      if (!response.ok) {
        let result = {};
        try {
          result = await response.json();
        } catch {}
        throw new Error(result.error || "Le dossier n’a pas pu être préparé.");
      }
      const blob = await response.blob();
      ctx.download(
        blob,
        `cap-sci-comptable-${requestOptions.startDate}-${requestOptions.endDate}.zip`,
        "application/zip",
      );
      ctx.toast("Le dossier comptable a été téléchargé.");
    } catch (e) {
      downloadError = e.message;
      error(content, e.message);
    } finally {
      busy = false;
      const b = content.querySelector("#download-accountant-zip");
      if (b) b.innerHTML = `${icon("download")}Télécharger le dossier ZIP`;
      preview(content);
    }
  }
  return { render };
}
