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
import { exportSelection, accountantCSVs } from "./accountant-export.js";
import { icon, esc } from "./ui.js";
export function createExportUI(ctx) {
  let values = null,
    selectedIds = null,
    ownerKey = null,
    busy = false,
    downloadError = "";
  const dateBasis = [
    { id: "payments", label: "Règlements réels" },
    { id: "due", label: "Échéances des opérations" },
    { id: "period", label: "Période concernée (mois)" },
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
    };
    selectedIds = null;
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
    content.innerHTML = `<section class="export-intro"><span class="feature-icon blue">${icon("receipt")}</span><div><h2>Un dossier clair pour votre comptable</h2><p>Choisissez les dates, les opérations et les pièces à transmettre. Le dossier ZIP rassemble les tableaux détaillés et les documents, avec un index qui les relie.</p></div></section><div class="export-layout"><section class="panel export-settings" aria-labelledby="export-settings-title"><div class="panel-heading"><div><h2 id="export-settings-title">Préparer le dossier</h2><p>Les dates de début et de fin sont incluses.</p></div></div><form id="accountant-export-form" novalidate><div class="form-grid">${ctx.field("startDate", "Du", values.startDate, "date", "required")}${ctx.field("endDate", "Au", values.endDate, "date", "required")}</div><div class="export-quick-dates"><button type="button" data-export-range="current">Année en cours</button><button type="button" data-export-range="previous">Année précédente</button><button type="button" data-export-range="month">Mois en cours</button></div>${ctx.selectField("dateBasis", "Dates à utiliser", dateBasis, values.dateBasis)}<p class="form-note" id="export-date-help"></p>${ctx.field("query", "Rechercher dans les opérations", values.query, "search", 'placeholder="Libellé, tiers, référence…" maxlength="300"')}${checkGroup(
      "types",
      "Types",
      [
        { id: "income", label: "Encaissements" },
        { id: "expense", label: "Décaissements" },
      ],
    )}${checkGroup("statuses", "Statuts", statusOptions)}<details class="export-extra"><summary>Filtrer par biens et catégories</summary>${checkGroup("propertyIds", "Biens", [{ id: "", label: "SCI / Général" }, ...ctx.getState().properties.map((p) => ({ id: p.id, label: p.name + (p.archived ? " (archivé)" : "") }))])}${checkGroup("categories", "Catégories", CATEGORIES)}</details><div class="export-document-options"><label class="check-label"><input type="checkbox" name="includeDocuments" ${values.includeDocuments ? "checked" : ""}>Inclure les justificatifs</label><p class="form-note">Les pièces des opérations retenues sont ajoutées au dossier ZIP, avec le libellé de leur opération et leur extension.</p><label class="check-label"><input type="checkbox" name="includeFullPaymentHistory" ${values.includeFullPaymentHistory ? "checked" : ""}>Inclure tous les règlements liés</label><p class="form-note">En mode « Règlements réels », ajoute aussi les règlements liés hors dates. Ils sont identifiés « Hors période » et exclus des totaux de la plage choisie.</p></div><p class="finance-error" role="alert" id="export-error"></p></form></section><section class="export-result"><div class="export-metrics"><div class="stat-card"><span>Opérations retenues</span><strong data-testid="export-operation-count">0</strong></div><div class="stat-card"><span>Règlements exportés</span><strong data-testid="export-payment-count">0</strong></div></div><div class="panel export-package"><div class="panel-heading"><h2>Le contenu du dossier</h2><span class="year-chip">ZIP</span></div><ul><li>${icon("receipt")}<span><strong>Opérations et règlements</strong><small>Montants attendus, réglés et restants, ventilation, dates, biens, tiers, références et notes.</small></span></li><li>${icon("building")}<span><strong>Biens et paramètres de la SCI</strong><small>Les informations nécessaires pour comprendre le dossier.</small></span></li><li>${icon("folder")}<span><strong>Justificatifs et index</strong><small>Un dossier par opération et un manifeste qui relie les fichiers à leurs écritures.</small></span></li></ul><div class="export-cash-summary" id="export-cash-summary"></div><div class="export-downloads"><button class="button primary" id="download-accountant-zip">${icon("download")}Télécharger le dossier ZIP</button><button class="button secondary" id="download-accountant-csv">${icon("download")}Télécharger le CSV des opérations</button></div><p class="form-note export-auth-note">${ctx.getUser() ? "Le ZIP utilise les données enregistrées sur le serveur au moment du téléchargement." : "Connectez-vous pour télécharger un ZIP avec les justificatifs de votre compte. Le CSV permet de découvrir l’export en démonstration."}</p><p class="form-note export-auth-note">Ce dossier prépare les échanges avec votre comptable ; il ne constitue pas un FEC ni une déclaration fiscale.</p></div></section></div><section class="panel export-preview"><div class="panel-heading"><div><h2>Vérifier les opérations à transmettre</h2><p>Décochez les opérations à exclure. Modifier un filtre réinitialise cette sélection.</p></div><label class="check-label"><input type="checkbox" id="export-select-all" checked>Tout inclure</label></div><div id="export-preview-body"></div></section>`;
    const form = content.querySelector("form");
    function read(event) {
      const f = new FormData(form);
      for (const key of ["startDate", "endDate", "dateBasis", "query"])
        values[key] = String(f.get(key) || "");
      for (const key of ["propertyIds", "categories", "types", "statuses"])
        values[key] = f.getAll(key).map(String);
      values.includeDocuments = f.has("includeDocuments");
      values.includeFullPaymentHistory = f.has("includeFullPaymentHistory");
      if (
        !["includeDocuments", "includeFullPaymentHistory"].includes(
          event?.target?.name,
        )
      )
        selectedIds = null;
      downloadError = "";
      preview(content);
    }
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    form.addEventListener("submit", (e) => e.preventDefault());
    content.querySelectorAll("[data-export-range]").forEach((b) =>
      b.addEventListener("click", () => {
        const y = new Date().getFullYear();
        const m = todayISO().slice(0, 7);
        const range = b.dataset.exportRange;
        form.elements.startDate.value =
          range === "month"
            ? `${m}-01`
            : `${range === "previous" ? y - 1 : y}-01-01`;
        form.elements.endDate.value =
          range === "month"
            ? new Date(y, new Date().getMonth() + 1, 0).toLocaleDateString(
                "sv-SE",
              )
            : `${range === "previous" ? y - 1 : y}-12-31`;
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
      .addEventListener("click", () => {
        try {
          const selection = select();
          const files = accountantCSVs(ctx.getState(), selection);
          ctx.download(
            files["operations.csv"],
            `cap-sci-operations-${values.startDate}-${values.endDate}.csv`,
            "text/csv;charset=utf-8",
          );
          ctx.toast("Le CSV détaillé a été téléchargé.");
        } catch (error) {
          error(content, error.message);
        }
      });
    preview(content);
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
              `<tr data-testid="export-operation-row"><td><input type="checkbox" data-export-operation="${esc(t.id)}" aria-label="Inclure ${esc(transactionLabel(t, ctx.getState()))}" ${selectedIds === null || selectedIds.has(t.id) ? "checked" : ""}></td><td><strong>${esc(transactionLabel(t, ctx.getState()))}</strong><small>${esc(categoryFor(t.category)?.label || "")} · ${esc({ paid: "Réglée", partial: "Partiellement réglée", pending: "Prévue", overdue: "En retard" }[transactionStatus(t)])}</small></td><td>${shortDate(t.dueDate || t.occurrenceDate || t.date)}</td><td>${money(t.amountCents)}</td><td>${money(paidCents(t))}</td><td>${money(remainingCents(t))}</td></tr>`,
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
      ctx.toast("Le dossier comptable et son index ont été téléchargés.");
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
