import {
  CATEGORIES, uid, fold, money, moneyInput, todayISO, shortDate,
  validateSupplier, validateTenant, validateLease, transactionLabel,
  paidCents, remainingCents,
} from "./model.js";
import { icon, esc } from "./ui.js";
import "./directory.css";

const kindNames = { supplier: "fournisseur", tenant: "locataire" };
const collections = { supplier: "suppliers", tenant: "tenants" };

export function createDirectoryUI(ctx) {
  const { getState, setState, persist, mountDialog, closeDialog, formHeader,
    formFooter, field, selectField, showErrors, allowMutation, confirmDialog } = ctx;
  const filters = { suppliers: "", tenants: "", leases: "" };
  const includeArchived = { suppliers: false, tenants: false };
  const rows = (name) => getState()[name] || [];
  const find = (name, id) => rows(name).find((r) => r.id === id);
  const propertyName = (id) => find("properties", id)?.name || "Bien introuvable";
  const tenantName = (id) => find("tenants", id)?.name || "Locataire introuvable";
  const leaseStatus = (l) => l.endDate && l.endDate < todayISO() ? "Terminée" : l.startDate > todayISO() ? "À venir" : "En cours";
  const notesField = (value) => `<div class="form-field"><label for="field-notes">Notes</label><textarea name="notes" id="field-notes" maxlength="3000" rows="3">${esc(value || "")}</textarea><span class="field-error" data-error="notes"></span></div>`;
  const detailItem = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "Non renseigné")}</dd></div>`;
  const button = (action, id, label, extra = "") => `<button type="button" class="text-link ${extra}" data-directory-action="${action}" data-id="${esc(id)}">${label}</button>`;

  function bind(container) {
    container.querySelectorAll("[data-directory-action]").forEach((b) => {
      b.addEventListener("click", () => action(b.dataset.directoryAction, b.dataset.id));
    });
  }
  function toolbar(view, placeholder) {
    return `<div class="directory-toolbar"><div class="search-field">${icon("search")}<input type="search" data-directory-search aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" value="${esc(filters[view])}"></div>${view !== "leases" ? `<label class="check-label"><input type="checkbox" data-directory-archived ${includeArchived[view] ? "checked" : ""}>Afficher les fiches désactivées</label>` : ""}</div>`;
  }
  function bindFilters(content, view) {
    content.querySelector("[data-directory-search]").addEventListener("input", (e) => {
      filters[view] = e.target.value;
      drawRows(content, view);
    });
    content.querySelector("[data-directory-archived]")?.addEventListener("change", (e) => {
      includeArchived[view] = e.target.checked;
      drawRows(content, view);
    });
  }
  function render(view, content) {
    if (!["suppliers", "tenants", "leases"].includes(view)) return;
    const definition = {
      suppliers: ["Vos fournisseurs", "Une fiche commune pour les coordonnées, les contrats et les dépenses.", "Rechercher un fournisseur", "add-supplier", "Ajouter un fournisseur"],
      tenants: ["Vos locataires", "Retrouvez leurs coordonnées, leurs locations et leurs documents.", "Rechercher un locataire", "add-tenant", "Ajouter un locataire"],
      leases: ["Les locations de vos biens", "Chaque occupation conserve son locataire, ses dates et ses documents.", "Rechercher une location", "add-lease", "Créer une location"],
    }[view];
    content.innerHTML = `<section class="panel directory-panel"><div class="panel-heading"><div><h2>${definition[0]}</h2><p>${definition[1]}</p></div></div>${toolbar(view, definition[2])}<div data-directory-rows></div></section>${view === "tenants" && rows("properties").some((p) => p.tenant) ? '<p class="form-note directory-help">Les noms déjà renseignés sur les biens restent conservés. Créez leurs fiches locataires puis leurs locations pour compléter les coordonnées et joindre les baux.</p>' : ""}`;
    bindFilters(content, view);
    drawRows(content, view);
  }
  function drawRows(content, view) {
    const query = fold(filters[view]);
    const filtered = rows(view).filter((row) => {
      if (view !== "leases" && !includeArchived[view] && row.archived) return false;
      const search = view === "leases"
        ? `${propertyName(row.propertyId)} ${tenantName(row.tenantId)} ${row.startDate} ${row.endDate}`
        : `${row.name} ${row.legalName || ""} ${row.email || ""} ${row.phone || ""} ${row.reference || ""}`;
      return fold(search).includes(query);
    }).sort((a, b) => view === "leases"
      ? b.startDate.localeCompare(a.startDate)
      : a.name.localeCompare(b.name, "fr"));
    const target = content.querySelector("[data-directory-rows]");
    target.innerHTML = filtered.length ? `<div class="directory-grid">${filtered.map((row) => view === "leases" ? leaseCard(row) : personCard(view === "suppliers" ? "supplier" : "tenant", row)).join("")}</div>` : `<div class="empty-state">${icon(view === "leases" ? "building" : "folder")}<h3>${query ? "Aucun résultat" : "Aucune fiche à afficher"}</h3><p>${query ? "Essayez un autre nom ou une autre référence." : view === "leases" ? "Créez une location après avoir ajouté un bien et un locataire." : "Ajoutez une première fiche pour retrouver toutes ses informations au même endroit."}</p></div>`;
    bind(target);
  }
  function personCard(kind, person) {
    const activeLeases = kind === "tenant" ? rows("leases").filter((l) => l.tenantId === person.id && leaseStatus(l) !== "Terminée") : [];
    const operations = rows("transactions").filter((t) => t[`${kind}Id`] === person.id);
    return `<article class="directory-card" data-testid="${kind}-card"><div class="directory-card-top"><span class="feature-icon blue">${icon(kind === "supplier" ? "receipt" : "building")}</span>${person.archived ? '<span class="status-pill pending">Désactivé</span>' : ""}</div><h3>${esc(person.name)}</h3><p>${esc(kind === "supplier" ? person.legalName || "Fournisseur" : activeLeases.map((l) => propertyName(l.propertyId)).join(" · ") || "Aucune location en cours")}</p><dl class="directory-mini">${detailItem("E-mail", person.email)}${detailItem("Téléphone", person.phone)}</dl><div class="directory-card-bottom"><span>${operations.length} opération${operations.length !== 1 ? "s" : ""}</span>${button(`view-${kind}`, person.id, "Ouvrir la fiche " + icon("arrow"))}</div></article>`;
  }
  function leaseCard(lease) {
    return `<article class="directory-card" data-testid="lease-card"><div class="directory-card-top"><span class="feature-icon blue">${icon("building")}</span><span class="status-pill ${leaseStatus(lease) === "En cours" ? "paid" : "pending"}">${leaseStatus(lease)}</span></div><h3>${esc(propertyName(lease.propertyId))}</h3><p>${esc(tenantName(lease.tenantId))}</p><dl class="directory-mini">${detailItem("Occupation", `${shortDate(lease.startDate)} → ${lease.endDate ? shortDate(lease.endDate) : "Sans date de fin"}`)}${detailItem("Loyer et provisions", money(lease.rentCents + lease.chargesCents))}</dl><div class="directory-card-bottom"><span>Échéance le ${lease.paymentDay}</span>${button("view-lease", lease.id, "Ouvrir la location " + icon("arrow"))}</div></article>`;
  }
  async function save(collection, value, message, callback) {
    const next = structuredClone(getState());
    next[collection] ||= [];
    const index = next[collection].findIndex((r) => r.id === value.id);
    if (index < 0) next[collection].push(value);
    else next[collection][index] = value;
    setState(next);
    closeDialog();
    await persist(message);
    callback?.(value);
  }
  function supplierForm(id, onSaved) {
    if (!allowMutation()) return;
    const existing = find("suppliers", id);
    const s = existing || { id: uid(), name: "", legalName: "", category: "", reference: "", address: "", email: "", phone: "", siret: "", notes: "", archived: false };
    const d = mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier le fournisseur" : "Nouveau fournisseur", "Une fiche réutilisable dans vos opérations et périodicités.", "receipt")}${field("name", "Nom court *", s.name, "text", 'maxlength="160" required')}${field("legalName", "Raison sociale", s.legalName, "text", 'maxlength="250"')}<div class="form-grid">${selectField("category", "Catégorie habituelle", [{ id: "", label: "Aucune catégorie par défaut" }, ...CATEGORIES.filter((c) => c.type === "expense")], s.category)}${field("reference", "Référence client ou contrat", s.reference, "text", 'maxlength="100"')}</div>${field("address", "Adresse", s.address, "text", 'maxlength="500"')}<div class="form-grid">${field("email", "E-mail", s.email, "email", 'maxlength="250"')}${field("phone", "Téléphone", s.phone, "tel", 'maxlength="40"')}</div>${field("siret", "SIRET", s.siret, "text", 'inputmode="numeric" maxlength="20"')}${notesField(s.notes)}<p class="form-note">La référence client ou contrat concerne le fournisseur. La référence de chaque facture reste renseignée sur son opération.</p>${formFooter(existing ? "Enregistrer" : "Créer le fournisseur")}</form></dialog>`);
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const result = validateSupplier({ ...s, ...Object.fromEntries(new FormData(e.currentTarget)), archived: s.archived }, getState());
      if (showErrors(d, result.errors)) return;
      await save("suppliers", result.value, "La fiche fournisseur a été enregistrée.", onSaved);
    });
  }
  function tenantForm(id, onSaved) {
    if (!allowMutation()) return;
    const existing = find("tenants", id);
    const t = existing || { id: uid(), name: "", email: "", phone: "", address: "", notes: "", archived: false };
    const d = mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier le locataire" : "Nouveau locataire", "Les coordonnées de la personne ou de l’entreprise locataire.", "building")}${field("name", "Nom et prénom / raison sociale *", t.name, "text", 'maxlength="160" required')}<div class="form-grid">${field("email", "E-mail", t.email, "email", 'maxlength="250"')}${field("phone", "Téléphone", t.phone, "tel", 'maxlength="40"')}</div>${field("address", "Adresse de correspondance", t.address, "text", 'maxlength="500"')}${notesField(t.notes)}<p class="form-note">Le bien, le loyer, les dates d’occupation et le bail se renseignent dans la location associée.</p>${formFooter(existing ? "Enregistrer" : "Créer le locataire")}</form></dialog>`);
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const result = validateTenant({ ...t, ...Object.fromEntries(new FormData(e.currentTarget)), archived: t.archived }, getState());
      if (showErrors(d, result.errors)) return;
      await save("tenants", result.value, "La fiche locataire a été enregistrée.", onSaved);
    });
  }
  function leaseForm(id, tenantId = "", propertyId = "", onSaved) {
    if (!allowMutation()) return;
    const existing = find("leases", id);
    const l = existing || { id: uid(), tenantId, propertyId, startDate: todayISO(), endDate: "", rentCents: 0, chargesCents: 0, depositCents: 0, paymentDay: 1, notes: "" };
    if (!existing && propertyId) { const p = find("properties", propertyId); if (p) { l.rentCents = p.rentCents; l.chargesCents = p.chargesCents; } }
    const people = rows("tenants").filter((t) => !t.archived || t.id === l.tenantId);
    const properties = rows("properties").filter((p) => !p.archived || p.id === l.propertyId);
    if (!people.length || !properties.length) {
      ctx.toast("Ajoutez d’abord un bien immobilier et un locataire.", true);
      return;
    }
    const linked = Boolean(existing);
    const d = mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier la location" : "Nouvelle location", "Une occupation datée pour conserver l’historique du bien.", "building")}<div class="form-grid">${selectField("tenantId", "Locataire *", [{ id: "", label: "Choisir un locataire" }, ...people.map((t) => ({ id: t.id, label: t.name + (t.archived ? " (désactivé)" : "") }))], l.tenantId)}${selectField("propertyId", "Bien *", [{ id: "", label: "Choisir un bien" }, ...properties.map((p) => ({ id: p.id, label: p.name }))], l.propertyId)}${field("startDate", "Date d’entrée *", l.startDate, "date", "required")}${field("endDate", "Date de sortie", l.endDate, "date")}${field("rent", "Loyer hors charges (€) *", moneyInput(l.rentCents), "text", 'inputmode="decimal" required')}${field("charges", "Provisions sur charges (€)", moneyInput(l.chargesCents), "text", 'inputmode="decimal"')}${field("deposit", "Dépôt de garantie prévu (€)", moneyInput(l.depositCents), "text", 'inputmode="decimal"')}${field("paymentDay", "Jour d’échéance du loyer *", l.paymentDay, "number", 'min="1" max="31" required')}</div>${notesField(l.notes)}${linked ? '<p class="form-note">Cette location enregistrée conserve son bien et son locataire. Créez une nouvelle location pour un changement d’occupant.</p>' : ""}<p class="form-note">La date de sortie limite les nouvelles échéances des périodicités liées. Les opérations et règlements déjà enregistrés sont conservés ; vérifiez les éventuelles échéances préparées au-delà de la sortie.</p><p class="form-note">Le dépôt est une référence contractuelle. Son encaissement et sa restitution se saisissent comme opérations distinctes.</p>${formFooter(existing ? "Enregistrer" : "Créer la location")}</form></dialog>`);
    if (linked) for (const name of ["tenantId", "propertyId"]) d.querySelector(`[name=${name}]`).disabled = true;
    d.querySelector("[name=propertyId]").addEventListener("change", (e) => {
      if (existing) return;
      const property = find("properties", e.target.value);
      if (!property) return;
      d.querySelector("[name=rent]").value = moneyInput(property.rentCents);
      d.querySelector("[name=charges]").value = moneyInput(property.chargesCents);
    });
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const result = validateLease({ ...l, ...Object.fromEntries(new FormData(e.currentTarget)) }, getState());
      if (result.value.rentCents <= 0) result.errors.rent="Le loyer hors charges doit être supérieur à zéro.";
      if (showErrors(d, result.errors)) return;
      const next = structuredClone(getState());
      next.leases ||= [];
      const index = next.leases.findIndex((r) => r.id === l.id);
      if (index < 0) next.leases.push(result.value);
      else next.leases[index] = result.value;
      if (result.value.endDate) {
        for (const rule of next.recurrences || []) {
          if (rule.leaseId !== l.id) continue;
          if (rule.startDate > result.value.endDate) {
            rule.active = false;
          } else {
            if (!rule.endDate || rule.endDate > result.value.endDate) rule.endDate = result.value.endDate;
            if (result.value.endDate < todayISO()) rule.active = false;
          }
        }
      }
      setState(next);
      closeDialog();
      await persist("La location et ses dates ont été enregistrées.");
      onSaved?.(result.value);
    });
  }
  function operationHistory(kind, id) {
    const linked = rows("transactions").filter((t) => t[`${kind}Id`] === id).sort((a, b) => b.date.localeCompare(a.date));
    return linked.length ? `<div class="directory-history"><p class="form-note">${linked.length} opération(s) rattachée(s). Les noms saisis sur les opérations conservent leur historique.</p><ul>${linked.map((t) => `<li><div>${button("edit-operation", t.id, esc(transactionLabel(t, getState())))}<span>${shortDate(t.date)} · ${esc(t.counterparty)}</span></div><div><strong>${money(t.amountCents)}</strong><span>Réglé : ${money(paidCents(t))} · Reste : ${money(remainingCents(t))}</span></div></li>`).join("")}</ul></div>` : '<div class="empty-state"><p>Aucune opération rattachée à cette fiche.</p></div>';
  }
  function personDetails(kind, id) {
    const person = find(collections[kind], id);
    if (!person) return;
    const d = mountDialog(`<dialog class="form-dialog directory-dialog" aria-labelledby="dialog-title">${formHeader(person.name, kind === "tenant" ? "Coordonnées, locations et documents du locataire." : "Coordonnées, documents et historique du fournisseur.", kind === "tenant" ? "building" : "receipt")}<div class="directory-tabs" role="tablist" aria-label="Contenu de la fiche"><button type="button" role="tab" id="directory-tab-contact" aria-controls="directory-detail" aria-selected="true" data-tab="contact">Coordonnées</button>${kind === "tenant" ? '<button type="button" role="tab" id="directory-tab-leases" aria-controls="directory-detail" aria-selected="false" data-tab="leases">Locations</button>' : ""}<button type="button" role="tab" id="directory-tab-documents" aria-controls="directory-detail" aria-selected="false" data-tab="documents">Documents</button><button type="button" role="tab" id="directory-tab-operations" aria-controls="directory-detail" aria-selected="false" data-tab="operations">Opérations</button></div><div id="directory-detail" role="tabpanel" tabindex="0" aria-labelledby="directory-tab-contact"></div><div class="dialog-footer"><button type="button" class="button secondary" data-close>Fermer</button></div></dialog>`);
    const panel = d.querySelector("#directory-detail");
    function tab(name) {
      for (const b of d.querySelectorAll("[data-tab]")) {
        b.setAttribute("aria-selected", String(b.dataset.tab === name));
        b.tabIndex = b.dataset.tab === name ? 0 : -1;
      }
      panel.setAttribute("aria-labelledby", `directory-tab-${name}`);
      if (name === "contact") {
        panel.innerHTML = `<dl class="directory-details">${detailItem("Nom", person.name)}${kind === "supplier" ? detailItem("Raison sociale", person.legalName) + detailItem("Référence client / contrat", person.reference) + detailItem("Catégorie habituelle", CATEGORIES.find((c) => c.id === person.category)?.label) + detailItem("SIRET", person.siret) : ""}${detailItem("E-mail", person.email)}${detailItem("Téléphone", person.phone)}${detailItem("Adresse", person.address)}${detailItem("Notes", person.notes)}</dl>${kind === "supplier" ? `<h3>Biens associés</h3><div class="directory-detail-actions">${rows("properties").filter(p => (p.supplierIds || []).includes(id) || rows("transactions").some(t => t.supplierId === id && t.propertyId === p.id) || rows("recurrences").some(r => r.supplierId === id && r.propertyId === p.id)).map(p => button("view-property", p.id, esc(p.name))).join("") || '<p class="form-note">Aucun bien rattaché.</p>'}</div>` : ""}<div class="directory-detail-actions">${button(`edit-${kind}`, id, icon("edit") + " Modifier")}${button(`archive-${kind}`, id, person.archived ? "Réactiver la fiche" : "Désactiver la fiche")}</div>`;
      } else if (name === "leases") {
        const leases = rows("leases").filter((l) => l.tenantId === id).sort((a,b) => b.startDate.localeCompare(a.startDate));
        panel.innerHTML = `<div class="directory-detail-actions">${button("tenant-add-lease", id, icon("plus") + " Nouvelle location")}</div>${leases.length ? `<div class="directory-grid">${leases.map(leaseCard).join("")}</div>` : '<div class="empty-state"><p>Aucune location rattachée.</p></div>'}`;
      } else if (name === "documents") {
        panel.innerHTML = `<div class="directory-doc-callout">${icon("folder")}<h3>Documents du ${kindNames[kind]}</h3><p>${kind === "tenant" ? "Conservez ici les documents concernant la personne. Les baux et états des lieux se joignent à la location du bien." : "Retrouvez les contrats et documents généraux du fournisseur. Les factures se joignent à leurs opérations."}</p>${button(`documents-${kind}`, id, "Gérer les documents")}</div>`;
      } else panel.innerHTML = operationHistory(kind, id);
      bind(panel);
    }
    d.querySelectorAll("[data-tab]").forEach((b) => {
      b.addEventListener("click", () => tab(b.dataset.tab));
      b.addEventListener("keydown", (e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const tabs = [...d.querySelectorAll("[data-tab]")], index = tabs.indexOf(b);
        const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus(); tab(tabs[next].dataset.tab);
      });
    });
    tab("contact");
  }
  function leaseDetails(id) {
    const l = find("leases", id);
    if (!l) return;
    const d = mountDialog(`<dialog class="form-dialog directory-dialog" aria-labelledby="dialog-title">${formHeader(propertyName(l.propertyId), tenantName(l.tenantId) + " · " + leaseStatus(l), "building")}<dl class="directory-details">${detailItem("Date d’entrée", shortDate(l.startDate))}${detailItem("Date de sortie", l.endDate ? shortDate(l.endDate) : "Non prévue")}${detailItem("Loyer hors charges", money(l.rentCents))}${detailItem("Provisions sur charges", money(l.chargesCents))}${detailItem("Dépôt de garantie prévu", money(l.depositCents))}${detailItem("Jour d’échéance", String(l.paymentDay))}${detailItem("Notes", l.notes)}</dl><div class="directory-detail-actions">${button("edit-lease", id, icon("edit") + " Modifier / terminer")}${button("documents-lease", id, icon("folder") + " Bail et documents")}${leaseStatus(l) !== "Terminée" ? button("lease-recurrence", id, icon("calendar") + " Préparer le loyer périodique") : ""}</div><h3 class="directory-history-title">Opérations de cette location</h3>${operationHistory("lease", id)}<div class="dialog-footer"><button type="button" class="button secondary" data-close>Fermer</button></div></dialog>`);
    bind(d);
  }
  function archive(kind, id) {
    if (!allowMutation()) return;
    const collection = collections[kind], person = find(collection, id);
    if (!person) return;
    if (kind === "tenant" && !person.archived && rows("leases").some((l) => l.tenantId === id && leaseStatus(l) !== "Terminée")) {
      ctx.toast("Terminez les locations en cours ou à venir avant de désactiver ce locataire.", true);
      return;
    }
    confirmDialog(person.archived ? "Réactiver cette fiche ?" : "Désactiver cette fiche ?", "Les locations, opérations et documents déjà rattachés restent conservés.", person.archived ? "Réactiver" : "Désactiver", () => {
      const next = structuredClone(getState());
      next[collection].find((row) => row.id === id).archived = !person.archived;
      setState(next);
      closeDialog();
      persist("Le statut de la fiche a été mis à jour.");
    });
  }
  function action(name, id) {
    const handlers = {
      "view-property": () => { closeDialog(); ctx.viewProperty(id); },
      "edit-operation": () => { closeDialog(); ctx.editTransaction(id); },
      "add-supplier": () => supplierForm(), "edit-supplier": () => { closeDialog(); supplierForm(id); },
      "add-tenant": () => tenantForm(), "edit-tenant": () => { closeDialog(); tenantForm(id); },
      "add-lease": () => leaseForm(), "edit-lease": () => { closeDialog(); leaseForm(id); },
      "tenant-add-lease": () => { closeDialog(); leaseForm(undefined, id); },
      "view-supplier": () => personDetails("supplier", id), "view-tenant": () => personDetails("tenant", id),
      "view-lease": () => leaseDetails(id),
      "archive-supplier": () => archive("supplier", id), "archive-tenant": () => archive("tenant", id),
      "documents-supplier": () => ctx.openEntityDocuments("supplier", id),
      "documents-tenant": () => ctx.openEntityDocuments("tenant", id),
      "documents-lease": () => ctx.openEntityDocuments("lease", id),
      "lease-recurrence": () => { closeDialog(); ctx.createRecurrenceForLease(id); },
    };
    if (!handlers[name]) return false;
    handlers[name]();
    return true;
  }
  return { render, action, supplierForm, tenantForm, leaseForm };
}
