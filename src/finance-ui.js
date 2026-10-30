import { entryRequirements } from "./entry-rules.js";
import {
  CATEGORIES,
  uid,
  money,
  moneyInput,
  shortDate,
  todayISO,
  parseMoney,
  categoryFor,
  transactionLabel,
  getPayments,
  paidCents,
  remainingCents,
  transactionStatus,
  validateRecurrence,
  validateRentRecurrence,
  validateTransaction,
  generateRecurringTransactions,
  monthEnd,
  nextRecurrenceDate,
  setRecurrenceActive,
  recordPayment,
  recordPaymentsBatch,
  suggestedAllocation,
  getForecast,
  leaseRentAt,
} from "./model.js";
import { icon, esc } from "./ui.js";
import { createBankCheckUI } from "./bank-check-ui.js";
import { assertNoBankMatch } from "./bank-reconciliation.js";
const frequencies = [
  { id: "monthly", label: "Mensuelle" },
  { id: "quarterly", label: "Trimestrielle" },
  { id: "yearly", label: "Annuelle" },
];
const statusNames = {
  paid: "Réglé",
  partial: "Partiellement réglé",
  overdue: "En retard",
  pending: "Prévu",
  cancelled: "Annulée",
};
export function createFinanceUI(ctx) {
  const {
    getState,
    getUser,
    persist,
    saveDialog,
    mountDialog,
    closeDialog,
    formHeader,
    formFooter,
    field,
    selectField,
    showErrors,
    options,
    allowMutation,
    toast,
    confirmDialog,
  } = ctx;
  const bankUI = createBankCheckUI(ctx);
  let pointingMonth = todayISO().slice(0, 7),
    pointingProperty = "all",
    pointingType = "all",
    pointingRemaining = "all",
    pointingDate = todayISO(),
    pointingOwner = null,
    selected = new Set();
  const prop = (id) => getState().properties.find((p) => p.id === id);
  const propertyOptions = () => [
    { id: "", label: "SCI / Général" },
    ...getState().properties.map((p) => ({
      id: p.id,
      label: p.name + (p.archived ? " (archivé)" : ""),
    })),
  ];
  const errorIn = (d, error) => {
    let el = d.querySelector(".finance-error");
    if (!el) {
      el = document.createElement("p");
      el.className = "finance-error";
      el.setAttribute("role", "alert");
      d.querySelector(".dialog-footer")?.before(el);
    }
    el.textContent = error.message;
  };
  const badge = (t) =>
    `<span class="status-pill ${transactionStatus(t)}">${statusNames[transactionStatus(t)]}${transactionStatus(t) === "partial" && (t.dueDate || t.date) < todayISO() ? " · En retard" : ""}</span>`;
  const loanSummary = (t) =>
    `Capital : ${money(t.capitalCents || 0)} · Intérêts : ${money(t.interestCents || 0)} · Assurance : ${money(t.insuranceCents || 0)}`;
  function loanFields(values = {}) {
    return `<div class="form-grid">${field("capital", "Capital remboursé (€) *", values.capital ?? "", "text", 'inputmode="decimal" required')}${field("interest", "Intérêts (€)", values.interest ?? "0,00", "text", 'inputmode="decimal"')}${field("insurance", "Assurance emprunteur (€)", values.insurance ?? "0,00", "text", 'inputmode="decimal"')}</div><p class="payment-summary"><strong>Total de l’échéance : <output id="loan-total" aria-live="polite"></output></strong></p><span class="field-error" data-error="amount"></span>`;
  }
  function updateLoanTotal(d) {
    const total = d.querySelector("#loan-total");
    if (!total) return;
    const parts = ["capital", "interest", "insurance"].map((name) =>
      parseMoney(d.querySelector(`[name=${name}]`).value || "0"),
    );
    total.textContent = parts.some((part) => part === null)
      ? "Vérifiez les montants"
      : money(parts.reduce((sum, part) => sum + part, 0));
  }
  function nextDisplayedRecurrence(rule) {
    const lease = (getState().leases || []).find(l => l.id === rule.leaseId);
    const from = rule.generatedThrough && rule.generatedThrough >= todayISO() ? nextDay(rule.generatedThrough) : todayISO();
    const end = lease?.endDate && (!rule.endDate || lease.endDate < rule.endDate) ? lease.endDate : rule.endDate;
    return nextRecurrenceDate({...rule, endDate:end || ""}, lease?.startDate && lease.startDate > from ? lease.startDate : from);
  }
  const displayedRule = rule => {
    const lease = (getState().leases || []).find(l => l.id === rule.leaseId);
    return rule.category === "rent" && lease ? {...rule, ...leaseRentAt(lease)} : rule;
  };
  function renderRecurrences(content) {
    const rules = getState().recurrences || [];
    content.innerHTML = `<div class="notice">${icon("calendar")}<span>Les échéances sont créées automatiquement jusqu’à la fin du mois courant, puis préparées à l’ouverture du mois suivant. Elles restent à pointer avant d’affecter la trésorerie. Une modification de périodicité s’applique aux échéances qui n’ont pas encore été créées.</span></div><div class="recurrence-grid">${rules.map(displayedRule).map((r) => `<article class="panel recurrence-card" data-testid="recurrence-card"><div class="recurrence-top"><span class="feature-icon ${r.type === "income" ? "green" : "amber"}">${icon(r.type)}</span><span class="status-pill ${r.active ? "paid" : "pending"}">${r.active ? "Active" : "En pause"}</span></div><h2>${esc(transactionLabel({ ...r, normalizedLabel: true, period: r.startDate.slice(0, 7) }, getState()))}</h2><strong class="recurrence-amount">${money(r.amountCents)} <small>/ ${frequencies.find((f) => f.id === r.frequency)?.label.toLowerCase()}</small></strong>${r.category === "rent" ? `<p>Loyer HC : ${money(r.rentCents)} · Provisions : ${money(r.chargesCents)}</p>` : r.category === "loan_payment" ? `<p>${loanSummary(r)}</p>` : ""}<dl><div><dt>Début</dt><dd>${shortDate(r.startDate)}</dd></div><div><dt>Fin</dt><dd>${r.endDate ? shortDate(r.endDate) : "Sans fin"}</dd></div><div><dt>Prochaine échéance à préparer</dt><dd>${r.active ? (nextDisplayedRecurrence(r) ? shortDate(nextDisplayedRecurrence(r)) : "Terminée") : "En pause"}</dd></div></dl><div class="property-actions"><button class="text-link" data-action="edit-recurrence" data-id="${esc(r.id)}">${icon("edit")}Modifier</button><button class="text-link" data-action="pause-recurrence" data-id="${esc(r.id)}">${r.active ? "Pause" : "Reprendre"}</button><button class="text-link danger-text" data-action="delete-recurrence" data-id="${esc(r.id)}">Supprimer</button></div></article>`).join("") || '<div class="empty-state"><h2>Votre premier rendez-vous régulier</h2><p>Ajoutez un loyer, une assurance ou une échéance de prêt.</p></div>'}</div>`;
  }
  function nextDay(date) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return todayISO(d);
  }
  function recurrenceForm(id, seed = {}) {
    if (!allowMutation()) return;
    const existing = getState().recurrences?.find((r) => r.id === id);
    const r = existing || {
      id: uid(),
      type: "income",
      category: "rent",
      propertyId: "",
      frequency: "monthly",
      startDate: todayISO(),
      endDate: "",
      amountCents: 0,
      rentCents: 0,
      chargesCents: 0,
      detail: "",
      counterparty: "",
      active: true,
      generatedThrough: "",
      ...seed,
    };
    const d = mountDialog(
      `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier la périodicité" : "Nouvelle périodicité", "Une seule saisie, des échéances préparées chaque mois.", "calendar")}<div class="form-grid">${selectField(
        "type",
        "Type",
        [
          { id: "income", label: "Encaissement" },
          { id: "expense", label: "Décaissement" },
        ],
        r.type,
      )}${selectField(
        "category",
        "Catégorie",
        CATEGORIES.filter((c) => c.type === r.type),
        r.category,
      )}${selectField("propertyId", "Bien", propertyOptions(), r.propertyId)}${selectField("frequency", "Fréquence", frequencies, r.frequency)}</div><div class="form-grid">${selectField("supplierId", "Fournisseur enregistré", [{id:"",label:"Aucun fournisseur"}, ...(getState().suppliers || []).filter(s => !s.archived || s.id === r.supplierId).map(s => ({id:s.id,label:s.name}))], r.supplierId || "")}${selectField("leaseId", "Location associée", [{id:"",label:"Aucune location"}, ...(getState().leases || []).map(l => ({id:l.id,label: `${prop(l.propertyId)?.name || "Bien"} · ${(getState().tenants || []).find(t => t.id === l.tenantId)?.name || "Locataire"}`}))], r.leaseId || "")}</div>${selectField("tenantId", "Locataire enregistré", [{id:"",label:"Aucun locataire"}, ...(getState().tenants || []).filter(t => !t.archived || t.id === r.tenantId).map(t => ({id:t.id,label:t.name}))],r.tenantId || "")}<p class="form-note">La location propose les montants du bail et son locataire. Le fournisseur propose sa catégorie habituelle.</p><div id="recurring-amounts"></div><div class="form-grid">${field("startDate", "Date de début *", r.startDate, "date", "required")}${field("endDate", "Date de fin", r.endDate, "date")}${field("paymentDay", "Jour d’échéance (1 à 31)", r.paymentDay || Number(r.startDate.slice(8,10)), "number", 'min="1" max="31" step="1" required')}</div>${field("detail", "Détail", r.detail || "", "text", 'maxlength="160" placeholder="Ex. : Assurance propriétaire"')}${field("counterparty", "Fournisseur / bénéficiaire / locataire", r.counterparty || "", "text", 'maxlength="160"')}<p class="form-note">La référence du contrat se conserve sur la fiche fournisseur. Le numéro de facture se renseigne sur chaque opération, après sa création.</p><div class="form-field"><label for="field-notes">Note pour le comptable</label><textarea id="field-notes" name="notes" maxlength="3000" rows="3">${esc(r.notes || "")}</textarea><span class="field-error" data-error="notes"></span></div><label class="check-label"><input type="checkbox" name="documentNotRequired" ${r.documentNotRequired ? "checked" : ""}>Justificatif non nécessaire pour ces échéances</label><p class="auto-label-preview" id="recurrence-preview"></p><p class="form-note">Le jour d’échéance choisi est conservé à chaque période. Si ce jour n’existe pas, l’échéance tombe le dernier jour du mois. Pour un prêt, choisissez « Échéance de prêt » et renseignez la répartition capital, intérêts et assurance. Vous pourrez l’ajuster chaque mois dans « Pointage mensuel », d’après le tableau d’amortissement bancaire.</p><p class="form-note">Les échéances jusqu’à la fin du mois courant seront ajoutées en attente. Les échéances déjà créées ne seront pas modifiées.</p>${formFooter(existing ? "Enregistrer" : "Créer la périodicité")}</form></dialog>`,
    );
    let customPaymentDay = !!r.paymentDay;
    d.querySelector("[name=paymentDay]").addEventListener("input", () => { customPaymentDay = true; });
    d.querySelector("[name=startDate]").addEventListener("input", e => {
      if (!customPaymentDay && e.target.value) d.querySelector("[name=paymentDay]").value = Number(e.target.value.slice(8,10));
    });
    const supplierSelect = d.querySelector("[name=supplierId]");
    if (ctx.createSupplier) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-link";
      button.textContent = "Créer un fournisseur";
      supplierSelect.closest(".form-field").append(button);
      button.addEventListener("click", () => ctx.createSupplier(supplier => {
        supplierSelect.innerHTML = options([{id:"",label:"Aucun fournisseur"}, ...(getState().suppliers || []).filter(s => !s.archived || s.id === supplier.id).map(s => ({id:s.id,label:s.name}))], supplier.id);
        supplierSelect.dispatchEvent(new Event("change"));
      }));
    }
    if (ctx.createTenant) {
      const select=d.querySelector("[name=tenantId]");
      const button=document.createElement("button");button.type="button";button.className="text-link";button.textContent="Créer un locataire";
      select.closest(".form-field").append(button);
      button.addEventListener("click",()=>ctx.createTenant(tenant=>{
        select.innerHTML=options([{id:"",label:"Aucun locataire"},...(getState().tenants || []).filter(t=>!t.archived || t.id===tenant.id).map(t=>({id:t.id,label:t.name}))],tenant.id);
        select.dispatchEvent(new Event("change",{bubbles:true}));
      }));
    }
    if(ctx.createLease) {
      const select=d.querySelector("[name=leaseId]");
      const button=document.createElement("button");button.type="button";button.className="text-link";button.textContent="Créer une location";
      select.closest(".form-field").append(button);
      button.addEventListener("click",()=>ctx.createLease({tenantId:d.querySelector("[name=tenantId]").value,propertyId:d.querySelector("[name=propertyId]").value},lease=>{
        select.innerHTML=options([{id:"",label:"Aucune location"},...(getState().leases || []).map(l=>({id:l.id,label:`${prop(l.propertyId)?.name || "Bien"} · ${(getState().tenants || []).find(t=>t.id===l.tenantId)?.name || "Locataire"}`}))],lease.id);
        select.dispatchEvent(new Event("change",{bubbles:true}));
      }));
    }
    function amounts() {
      const oldAmount = d.querySelector("[name=amount]")?.value;
      const oldRent = d.querySelector("[name=rent]")?.value;
      const oldCharges = d.querySelector("[name=charges]")?.value;
      const oldLoan = Object.fromEntries(["capital", "interest", "insurance"].map((name) => [name, d.querySelector(`[name=${name}]`)?.value]));
      const category = d.querySelector("[name=category]").value;
      const rental = category === "rent";
      const amount =
        oldAmount ??
        (oldLoan.capital !== undefined
          ? moneyInput(["capital", "interest", "insurance"].reduce((sum, name) => sum + (parseMoney(oldLoan[name] || "0") || 0), 0))
          : undefined) ??
        (oldRent !== undefined &&
        parseMoney(oldRent) !== null &&
        parseMoney(oldCharges || "0") !== null
          ? moneyInput(parseMoney(oldRent) + parseMoney(oldCharges || "0"))
          : r.amountCents
            ? moneyInput(r.amountCents)
            : "");
      const rent =
        oldRent ??
        oldAmount ??
        (r.rentCents !== undefined
          ? moneyInput(r.rentCents)
          : r.category === "rent"
            ? moneyInput(r.amountCents)
            : "");
      const charges =
        oldCharges ??
        (oldAmount !== undefined ? "0,00" : moneyInput(r.chargesCents || 0));
      d.querySelector("#recurring-amounts").innerHTML = rental
        ? `<div class="form-grid">${field("rent", "Loyer hors charges (€) *", rent, "text", 'inputmode="decimal" required')}${field("charges", "Provisions sur charges (€)", charges, "text", 'inputmode="decimal"')}</div>`
        : category === "loan_payment"
          ? loanFields({
              capital: oldLoan.capital ?? (r.category === "loan_payment" ? moneyInput(r.capitalCents || 0) : amount),
              interest: oldLoan.interest ?? moneyInput(r.category === "loan_payment" ? r.interestCents || 0 : 0),
              insurance: oldLoan.insurance ?? moneyInput(r.category === "loan_payment" ? r.insuranceCents || 0 : 0),
            })
          : field(
            "amount",
            "Montant (€) *",
            amount,
            "text",
            'inputmode="decimal" required',
          );
      const linkedLease = (getState().leases || []).find(l => l.id === d.querySelector("[name=leaseId]").value);
      if (linkedLease && category === "rent") {
        const scheduled = leaseRentAt(linkedLease, d.querySelector("[name=startDate]").value || todayISO());
        for (const [name, cents] of [["rent", scheduled.rentCents], ["charges", scheduled.chargesCents]]) {
          const input = d.querySelector(`[name=${name}]`);
          if (input) { input.value = moneyInput(cents); input.readOnly = true; }
        }
      }
      preview();
    }
    function preview() {
      updateLoanTotal(d);
      const lease = (getState().leases || []).find(l => l.id === d.querySelector("[name=leaseId]").value);
      if (lease && d.querySelector("[name=category]").value === "rent" && d.querySelector("[name=rent]")) {
        const amounts = leaseRentAt(lease, d.querySelector("[name=startDate]").value || todayISO());
        d.querySelector("[name=rent]").value = moneyInput(amounts.rentCents);
        d.querySelector("[name=charges]").value = moneyInput(amounts.chargesCents);
      }
      const values = Object.fromEntries(new FormData(d.querySelector("form")));
      d.querySelector("#recurrence-preview").textContent = transactionLabel(
        {
          ...r,
          ...values,
          normalizedLabel: true,
          period: values.startDate?.slice(0, 7),
        },
        getState(),
      );
    }
    function clearLease() {
      d.querySelector("[name=leaseId]").value = "";
      d.querySelector("[name=tenantId]").value = "";
    }
    d.querySelector("[name=type]").addEventListener("change", (e) => {
      clearLease();
      if (e.target.value !== "expense") d.querySelector("[name=supplierId]").value = "";
      d.querySelector("[name=category]").innerHTML = options(
        CATEGORIES.filter((c) => c.type === e.target.value),
        "",
      );
      amounts();
    });
    d.querySelector("[name=category]").addEventListener("change", amounts);
    d.querySelector("[name=propertyId]").addEventListener("change", (e) => {
      clearLease();
      const p = prop(e.target.value);
      if (p && d.querySelector("[name=rent]")) {
        d.querySelector("[name=rent]").value = moneyInput(p.rentCents);
        d.querySelector("[name=charges]").value = moneyInput(p.chargesCents);
        if (!d.querySelector("[name=counterparty]").value)
          d.querySelector("[name=counterparty]").value = p.tenant;
      }
      if (p && d.querySelector("[name=type]").value === "income" && d.querySelector("[name=category]").value === "rent") {
        const date=d.querySelector("[name=startDate]").value;
        const matches=(getState().leases || []).filter(l=>l.propertyId===p.id && l.startDate<=date && (!l.endDate || l.endDate>=date));
        if(matches.length===1) { const select=d.querySelector("[name=leaseId]");select.value=matches[0].id;select.dispatchEvent(new Event("change",{bubbles:true})); }
      }
      preview();
    });
    d.querySelector("[name=supplierId]").addEventListener("change", (e) => {
      const supplier = (getState().suppliers || []).find(s => s.id === e.target.value);
      if (!supplier) return;
      clearLease();
      if (d.querySelector("[name=type]").value === "expense")
        d.querySelector("[name=category]").innerHTML = options(CATEGORIES.filter(c => c.type === "expense"), supplier.category || "other_expense");
      d.querySelector("[name=counterparty]").value = supplier.name;
      const properties=getState().properties.filter(p=>(p.supplierIds || []).includes(supplier.id));
      if(!d.querySelector("[name=propertyId]").value && properties.length===1) d.querySelector("[name=propertyId]").value=properties[0].id;
      amounts();
    });
    d.querySelector("[name=tenantId]").addEventListener("change", e => {
      const tenant = (getState().tenants || []).find(t => t.id === e.target.value);
      d.querySelector("[name=leaseId]").value = "";
      if (tenant) {
        d.querySelector("[name=supplierId]").value = "";
        d.querySelector("[name=counterparty]").value = tenant.name;
        const property = d.querySelector("[name=propertyId]").value;
        const date = d.querySelector("[name=startDate]").value;
        const matches = (getState().leases || []).filter(l => l.tenantId === tenant.id && (!property || l.propertyId === property) && l.startDate <= date && (!l.endDate || l.endDate >= date));
        if (matches.length === 1) { const select=d.querySelector("[name=leaseId]");select.value=matches[0].id;select.dispatchEvent(new Event("change",{bubbles:true})); }
      }
      preview();
    });
    d.querySelector("[name=leaseId]").addEventListener("change", (e) => {
      const lease = (getState().leases || []).find(l => l.id === e.target.value);
      if (!lease) { d.querySelector("[name=tenantId]").value = ""; return; }
      const tenant = (getState().tenants || []).find(t => t.id === lease.tenantId);
      d.querySelector("[name=supplierId]").value = "";
      d.querySelector("[name=tenantId]").value = lease.tenantId;
      const category = d.querySelector("[name=category]").value;
      if (!["rent", "recoverable", "deposit_received", "deposit_returned"].includes(category)) {
        d.querySelector("[name=type]").value = "income";
        d.querySelector("[name=category]").innerHTML = options(CATEGORIES.filter(c => c.type === "income"), "rent");
      }
      d.querySelector("[name=propertyId]").value = lease.propertyId;
      d.querySelector("[name=counterparty]").value = tenant?.name || "";
      d.querySelector("[name=startDate]").value = firstLeasePayment(lease);
      d.querySelector("[name=paymentDay]").value = lease.paymentDay;
      customPaymentDay = true;
      d.querySelector("[name=endDate]").value = lease.endDate || "";
      amounts();
      if (d.querySelector("[name=rent]")) {
        d.querySelector("[name=rent]").value = moneyInput(leaseRentAt(lease, d.querySelector("[name=startDate]").value).rentCents);
        d.querySelector("[name=charges]").value = moneyInput(leaseRentAt(lease, d.querySelector("[name=startDate]").value).chargesCents);
      } else if (d.querySelector("[name=amount]")) {
        d.querySelector("[name=amount]").value = moneyInput(category === "recoverable" ? lease.chargesCents : lease.depositCents);
      }
      preview();
    });
    d.querySelector("form").addEventListener("input", preview);
    amounts();
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const result = validateRecurrence(
        {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          id: r.id,
          active: r.active,
          generatedThrough: r.generatedThrough,
          documentNotRequired: e.currentTarget.elements.documentNotRequired.checked,
          reference: "",
        },
        getState(),
      );
      Object.assign(result.errors, entryRequirements(result.value));
      const duplicateRent = validateRentRecurrence(result.value, getState());
      if (duplicateRent) result.errors.leaseId = duplicateRent;
      if (showErrors(d, result.errors)) return;
      try {
        await saveDialog(d, "La périodicité et ses échéances ont été enregistrées.", () => {
          const next = structuredClone(getState());
          next.recurrences ||= [];
          const index = next.recurrences.findIndex(row => row.id === result.value.id);
          if (index < 0) next.recurrences.push(result.value);
          else next.recurrences[index] = result.value;
          generateRecurringTransactions(next, monthEnd(todayISO()));
          ctx.setState(next);
        });
      } catch (error) {
        errorIn(d, error);
      }
    });
  }
  function firstLeasePayment(lease) {
    const start = lease.startDate;
    let [year, month] = start.split("-").map(Number);
    const candidate = () => `${year}-${String(month).padStart(2,"0")}-${String(Math.min(lease.paymentDay || 1, new Date(year, month, 0).getDate())).padStart(2,"0")}`;
    if (candidate() < start) { month++; if (month === 13) { month = 1; year++; } }
    return candidate();
  }
  function createFromLease(leaseId) {
    const lease = (getState().leases || []).find(l => l.id === leaseId);
    if (!lease) return;
    const existing = (getState().recurrences || []).filter(rule => rule.leaseId === leaseId && rule.category === "rent")
      .sort((a,b) => Number(b.active) - Number(a.active) || b.startDate.localeCompare(a.startDate))[0];
    if (existing) {
      recurrenceForm(existing.id);
      toast("Cette location possède déjà une périodicité. Modifiez-la ou reprenez-la plutôt que de créer un double loyer.");
      return;
    }
    if (lease.endDate && firstLeasePayment(lease) > lease.endDate) {
      toast("Cette location se termine avant sa première échéance. Saisissez le loyer au prorata dans les opérations.", true);
      return;
    }
    recurrenceForm(undefined, { leaseId, tenantId: lease.tenantId, propertyId: lease.propertyId,
      counterparty: (getState().tenants || []).find(t => t.id === lease.tenantId)?.name || "",
      startDate: firstLeasePayment(lease), paymentDay: lease.paymentDay, endDate: lease.endDate || "", ...leaseRentAt(lease, firstLeasePayment(lease)) });
  }
  function pointingRows(arrears = false) {
    return getState()
      .transactions.filter((t) => !t.cancelledAt)
      .filter((t) =>
        arrears
          ? t.type === "income" &&
            t.category === "rent" &&
            remainingCents(t) > 0 &&
            (t.occurrenceDate || t.dueDate || t.date) < todayISO()
          : (t.occurrenceDate || t.dueDate || t.date).slice(0, 7) ===
            pointingMonth,
      )
      .filter(t => (pointingProperty === "all" || t.propertyId === pointingProperty) &&
        (pointingType === "all" || t.type === pointingType) &&
        (pointingRemaining === "all" || remainingCents(t) > 0))
      .sort((a, b) =>
        (a.occurrenceDate || a.dueDate || a.date).localeCompare(
          b.occurrenceDate || b.dueDate || b.date,
        ),
      );
  }
  function renderPointing(content, arrears = false) {
    const owner = getUser()?.id || "demo";
    if (owner !== pointingOwner) {
      pointingOwner = owner;
      pointingProperty = "all";
      pointingType = "all";
      pointingRemaining = "all";
      pointingDate = todayISO();
    }
    selected.clear();
    const rows = pointingRows(arrears);
    const outstanding = rows.reduce((n, t) => n + remainingCents(t), 0);
    content.innerHTML = `<div class="pointing-toolbar">${arrears ? `<div><strong>${money(outstanding)}</strong><span> de loyers et provisions restant à recevoir</span></div>` : `<div class="form-field"><label for="pointing-month">Mois à pointer</label><input type="month" id="pointing-month" aria-label="Mois à pointer" value="${pointingMonth}" max="${todayISO().slice(0, 7)}"></div>`}<div class="form-field"><label for="pointing-date">Date des règlements</label><input type="date" id="pointing-date" value="${pointingDate}"></div><button class="button primary" data-action="settle-batch" disabled>Valider les règlements</button></div><div class="pointing-toolbar">${selectField("pointingProperty", "Bien à pointer", [{id:"all",label:"Tous les biens"}, ...propertyOptions()], pointingProperty)}${selectField("pointingType", "Sens des opérations", [{id:"all",label:"Encaissements et décaissements"},{id:"income",label:"Encaissements"},{id:"expense",label:"Décaissements"}], pointingType)}${selectField("pointingRemaining", "Échéances affichées", [{id:"all",label:"Toutes les échéances"},{id:"remaining",label:"Reste à pointer"}], pointingRemaining)}</div><section class="panel"><div class="panel-heading"><div><h2>${arrears ? "Loyers échus non soldés" : "Votre pointage du mois"}</h2><p>Vérifiez les mouvements réels sur votre relevé. Les cases cochées seront soldées à la date choisie.</p></div><span id="selection-total">0 sélectionnée</span></div>${rows.length ? `<div class="table-scroll finance-scroll" tabindex="0" role="region" aria-label="Tableau défilant des données"><table class="ledger pointing-table"><thead><tr><th><input type="checkbox" id="select-all" aria-label="Tout sélectionner"></th><th>Opération / échéance</th><th>Attendu</th><th>Réglé</th><th>Reste</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${rows.map((t) => `<tr data-testid="pointing-row"><td><input type="checkbox" data-point-id="${esc(t.id)}" aria-label="Sélectionner ${esc(transactionLabel(t, getState()))}" ${remainingCents(t) <= 0 ? "disabled" : ""}></td><td><strong>${esc(transactionLabel(t, getState()))}</strong><small>${shortDate(t.occurrenceDate || t.dueDate || t.date)}</small>${t.category === "loan_payment" ? `<small>${loanSummary(t)}</small>` : ""}${ctx.attachmentStatus.html(t.id)}</td><td>${money(t.amountCents)}</td><td>${money(paidCents(t))}</td><td><strong>${money(remainingCents(t))}</strong></td><td>${badge(t)}</td><td><div class="point-actions">${t.category === "loan_payment" ? `<button class="text-link" data-action="adjust-loan" data-id="${esc(t.id)}">Ajuster le prêt</button>` : ""}${remainingCents(t) > 0 ? `<button class="text-link" data-action="partial-payment" data-id="${esc(t.id)}">Paiement partiel</button>` : ""}<button class="text-link" data-action="payments-history" data-id="${esc(t.id)}">Règlements</button><button class="text-link" data-action="attachments" data-id="${esc(t.id)}">Justificatifs</button></div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><h3>Aucune échéance à afficher</h3><p>Vos opérations et périodicités apparaîtront ici.</p></div>'}</section><div class="accounting-note">${icon("check")}<p>Une validation groupée règle la totalité du reste dû. Pour un montant différent, utilisez « Paiement partiel ». Vous pouvez retrouver et annuler un règlement saisi par erreur dans « Règlements ».</p></div>`;
    content
      .querySelector("#pointing-month")
      ?.addEventListener("change", (e) => {
        if (
          /^\d{4}-\d{2}$/.test(e.target.value) &&
          e.target.value <= todayISO().slice(0, 7)
        ) {
          pointingMonth = e.target.value;
          renderPointing(content, false);
        }
      });
    content.querySelector("#pointing-date").addEventListener("change", e => { pointingDate = e.target.value; });
    for (const name of ["pointingProperty", "pointingType", "pointingRemaining"]) {
      content.querySelector(`[name=${name}]`).addEventListener("change", e => {
        if (name === "pointingProperty") pointingProperty = e.target.value;
        if (name === "pointingType") pointingType = e.target.value;
        if (name === "pointingRemaining") pointingRemaining = e.target.value;
        renderPointing(content, arrears);
      });
    }
    const boxes = [...content.querySelectorAll("[data-point-id]")];
    function selection() {
      const eligible = boxes.filter((b) => !b.disabled);
      content.querySelector("#select-all").checked =
        !!eligible.length && eligible.every((b) => b.checked);
      content.querySelector("#select-all").indeterminate =
        selected.size > 0 && selected.size < eligible.length;
      content.querySelector("[data-action=settle-batch]").disabled =
        !selected.size;
      const sum = rows
        .filter((t) => selected.has(t.id))
        .reduce((n, t) => n + remainingCents(t), 0);
      content.querySelector("#selection-total").textContent =
        `${selected.size} sélectionnée(s) · ${money(sum)}`;
    }
    boxes.forEach((b) =>
      b.addEventListener("change", () => {
        if (b.checked) selected.add(b.dataset.pointId);
        else selected.delete(b.dataset.pointId);
        selection();
      }),
    );
    content.querySelector("#select-all")?.addEventListener("change", (e) => {
      boxes
        .filter((b) => !b.disabled)
        .forEach((b) => {
          b.checked = e.target.checked;
          if (b.checked) selected.add(b.dataset.pointId);
          else selected.delete(b.dataset.pointId);
        });
      selection();
    });
  }
  function batchPayment() {
    if (!allowMutation() || !selected.size) return;
    const ids = [...selected],
      date = document.querySelector("#pointing-date").value;
    const total = getState()
      .transactions.filter((t) => selected.has(t.id))
      .reduce((n, t) => n + remainingCents(t), 0);
    confirmDialog(
      "Valider les règlements ?",
      `${ids.length} opération(s), soit ${money(total)}, à la date du ${shortDate(date)}.`,
      "Valider les règlements",
      d => saveDialog(d, "Les règlements sélectionnés ont été enregistrés.", () => {
        recordPaymentsBatch(getState(), ids, date);
      }),
    );
  }
  function loanForm(id) {
    if (!allowMutation()) return;
    const t = getState().transactions.find((row) => row.id === id);
    if (!t || t.cancelledAt || t.category !== "loan_payment") return;
    const d = mountDialog(
      `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Ajuster le prêt", transactionLabel(t, getState()), "edit")}${loanFields({ capital: moneyInput(t.capitalCents || 0), interest: moneyInput(t.interestCents || 0), insurance: moneyInput(t.insuranceCents || 0) })}<p class="form-note">Reportez la répartition du tableau d’amortissement bancaire pour cette échéance. Seule cette opération sera modifiée ; la périodicité et les autres mois seront conservés.</p>${getPayments(t).length ? '<p class="form-note">Cette opération comporte déjà un règlement : vous pouvez corriger la répartition en conservant le même total.</p>' : ""}${formFooter("Enregistrer la répartition")}</form></dialog>`,
    );
    updateLoanTotal(d);
    d.querySelector("form").addEventListener("input", () => updateLoanTotal(d));
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = { ...t, ...Object.fromEntries(new FormData(e.currentTarget)) };
      delete input.amount;
      const result = validateTransaction(input, getState());
      if (showErrors(d, result.errors)) return;
      try {
        await saveDialog(d, "La répartition de cette échéance de prêt a été enregistrée.", () => {
          const next = structuredClone(getState());
          next.transactions = next.transactions.map((row) => row.id === id ? result.value : row);
          ctx.setState(next);
        });
      } catch (error) {
        errorIn(d, error);
      }
    });
  }
  function paymentForm(id) {
    if (!allowMutation()) return;
    const t = getState().transactions.find((t) => t.id === id);
    if (!t || t.cancelledAt) return;
    const rental = t.category === "rent";
    const d = mountDialog(
      `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Enregistrer le règlement", transactionLabel(t, getState()), "check")}<div class="payment-summary"><span>Attendu : ${money(t.amountCents)}</span><span>Déjà réglé : ${money(paidCents(t))}</span><strong>Reste : ${money(remainingCents(t))}</strong></div>${field("date", "Date du règlement *", todayISO(), "date", "required")}${field("amount", "Montant réglé (€) *", moneyInput(remainingCents(t)), "text", 'inputmode="decimal" required')}${rental ? `<div class="form-grid">${field("rentAmount", "Part loyer (€)", "", "text", 'inputmode="decimal"')}${field("chargesAmount", "Part provisions (€)", "", "text", 'inputmode="decimal"')}</div><p class="form-note">Ventilation proportionnelle proposée sur le reste dû, modifiable avant validation.</p>` : ""}${formFooter("Enregistrer le règlement")}</form></dialog>`,
    );
    function allocation() {
      if (!rental) return;
      const amount = parseMoney(d.querySelector("[name=amount]").value);
      if (amount === null) return;
      try {
        const allocation = suggestedAllocation(t, amount);
        d.querySelector("[name=rentAmount]").value = moneyInput(
          allocation.rentCents,
        );
        d.querySelector("[name=chargesAmount]").value = moneyInput(
          allocation.chargesCents,
        );
      } catch {
        /* Submit displays the invalid amount; keep the current proposal. */
      }
    }
    allocation();
    d.querySelector("[name=amount]").addEventListener("input", allocation);
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.currentTarget));
      try {
        await saveDialog(d, "Le règlement a été enregistré.", () => {
          recordPayment(getState(), id, values);
        });
      } catch (error) {
        errorIn(d, error);
      }
    });
  }
  function paymentHistory(id) {
    const t = getState().transactions.find((t) => t.id === id);
    if (!t) return;
    const payments = getPayments(t);
    const d = mountDialog(
      `<dialog class="form-dialog" aria-labelledby="dialog-title">${formHeader("Règlements", transactionLabel(t, getState()), "receipt")}<p class="form-note">${money(paidCents(t))} réglés sur ${money(t.amountCents)}. Chaque règlement affecte la trésorerie à sa propre date.</p><ul class="payment-list">${payments.map((p) => `<li><span>${shortDate(p.date)}<strong>${money(p.amountCents)}</strong>${t.category === "rent" ? `<small>Loyer ${money(p.rentCents ?? p.amountCents)} · Provisions ${money(p.chargesCents ?? 0)}</small>` : ""}</span><button class="text-link danger-text" data-cancel-payment="${esc(p.id)}">Annuler ce règlement</button></li>`).join("") || "<li>Aucun règlement enregistré.</li>"}</ul><div class="dialog-footer"><button class="button secondary" data-close>Fermer</button>${remainingCents(t) > 0 ? '<button class="button primary" id="add-payment">Ajouter un règlement</button>' : ""}</div></dialog>`,
    );
    d.querySelector("#add-payment")?.addEventListener("click", () => {
      if (!allowMutation()) return;
      closeDialog(d);
      paymentForm(id);
    });
    d.querySelectorAll("[data-cancel-payment]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!allowMutation()) return;
        const paymentId = b.dataset.cancelPayment;
        confirmDialog(
          "Annuler ce règlement ?",
          "Le montant sera retiré de la trésorerie à sa date initiale. L’échéance restera dans le suivi.",
          "Annuler le règlement",
          confirmation => saveDialog(confirmation, "Le règlement a été annulé.", () => {
            assertNoBankMatch(getState(), { transactionId: id, paymentId });
            const transaction = getState().transactions.find(row => row.id === id);
            transaction.payments = getPayments(transaction).filter((p) => p.id !== paymentId);
            transaction.status = "pending";
          }, () => closeDialog(d)),
        );
      }),
    );
  }
  function renderForecast(content) {
    const f = getForecast(getState(), { months: 12, today: todayISO() });
    content.innerHTML = `<div class="notice">${icon("calendar")}<span>Projection sur 12 mois à partir de la trésorerie réelle d’aujourd’hui. Les périodicités et opérations prévues sont prises en compte une seule fois. Les impayés échus sont affichés séparément : leur règlement n’est pas supposé acquis.</span></div><div class="forecast-summary"><div class="stat-card"><span>Trésorerie de départ</span><strong>${f.openingBalance === null ? "Non disponible" : money(f.openingBalance)}</strong></div><div class="stat-card"><span>Encaissements échus en attente</span><strong>${money(f.overdueIncome)}</strong></div><div class="stat-card"><span>Décaissements échus en attente</span><strong>${money(f.overdueExpense)}</strong></div></div><section class="panel"><div class="panel-heading"><h2>Les 12 prochains mois</h2><span class="year-chip">Prévision, pas un solde bancaire</span></div><div class="table-scroll finance-scroll" tabindex="0" role="region" aria-label="Tableau défilant des données"><table class="ledger"><thead><tr><th>Mois</th><th>Encaissements prévus</th><th>Décaissements prévus</th><th>Trésorerie projetée en fin de mois</th></tr></thead><tbody>${f.months.map((m) => `<tr data-testid="forecast-row"><td>${esc(m.label)}</td><td class="amount income">${money(m.income)}</td><td class="amount expense">${money(m.expense)}</td><td class="amount ${m.balance < 0 ? "forecast-negative" : ""}">${m.balance === null ? "Non disponible" : money(m.balance)}${m.balance < 0 ? " · À surveiller" : ""}</td></tr>`).join("")}</tbody></table></div></section><p class="form-note forecast-note">Hypothèse : les sommes prévues seront réglées à leur échéance. La projection ne déclenche aucun paiement et ne modifie pas votre trésorerie réelle.</p>`;
  }
  async function attachmentDialog(id) {
    const t = getState().transactions.find((t) => t.id === id);
    if (!t) return;
    if (!getUser()) {
      toast(
        "Créez un compte pour conserver vos justificatifs sur le serveur.",
        true,
      );
      return;
    }
    const d = mountDialog(
      `<dialog class="form-dialog" aria-labelledby="dialog-title">${formHeader("Justificatifs", transactionLabel(t, getState()), "folder")}<div id="attachment-list">Chargement…</div><div class="form-field"><label for="attachment-file">Ajouter un justificatif</label><input id="attachment-file" type="file" multiple accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"></div><p class="form-note">PDF, JPEG ou PNG · 5 Mo maximum par fichier · 20 fichiers par opération. Les pièces sont renommées selon le libellé de l’opération (extension conservée, numérotation si nécessaire). Leur nom original est gardé comme référence. Les pièces sont conservées côté serveur. L’export JSON de la SCI ne contient pas leurs fichiers : téléchargez-les ou sauvegardez la base serveur.</p><p class="finance-error" role="alert"></p><div class="dialog-footer"><button class="button secondary" data-close>Fermer</button></div></dialog>`,
    );
    async function list() {
      const res = await fetch(
        `/api/transactions/${encodeURIComponent(id)}/attachments`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible.");
      ctx.attachmentStatus.setCount(id, data.attachments.length);
      d.querySelector("#attachment-list").innerHTML =
        `<ul class="payment-list">${data.attachments.map((a) => `<li><span><a href="/api/attachments/${encodeURIComponent(a.id)}" download>${esc(a.name)}</a><small>${Math.ceil(a.size / 1024)} Ko · ${shortDate(a.createdAt.slice(0, 10))}${a.originalName ? ` · Original : ${esc(a.originalName)}` : ""}</small></span><button class="text-link danger-text" data-remove-file="${esc(a.id)}">Supprimer</button></li>`).join("") || "<li>Aucun justificatif pour cette opération.</li>"}</ul>`;
      d.querySelectorAll("[data-remove-file]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!confirm("Supprimer définitivement ce justificatif ?")) return;
          try {
            const r = await fetch(
              `/api/attachments/${encodeURIComponent(b.dataset.removeFile)}`,
              { method: "DELETE" },
            );
            if (!r.ok) throw new Error((await r.json()).error);
            await list();
          } catch (error) {
            errorIn(d, error);
          }
        }),
      );
    }
    d.querySelector("#attachment-file").addEventListener(
      "change",
      async (e) => {
        const files = [...(e.target.files || [])];
        if (!files.length) return;
        e.target.disabled = true;
        const failures = [];
        let uploaded = 0;
        d.querySelector(".finance-error").textContent = "";
        for (const file of files) {
          try {
            if (file.size > 5 * 1024 * 1024) throw new Error("Le fichier dépasse 5 Mo.");
            const response = await fetch(`/api/transactions/${encodeURIComponent(id)}/attachments`, {
              method: "POST", headers: {"Content-Type":"application/octet-stream", "X-File-Name":encodeURIComponent(file.name)}, body:file,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Envoi impossible.");
            uploaded++;
          } catch (error) { failures.push(`${file.name} : ${error.message}`); }
        }
        try { await list(); } catch (error) { failures.push(error.message); }
        if (uploaded) toast(`${uploaded} justificatif${uploaded > 1 ? "s ont été enregistrés" : " a été enregistré"}.`);
        if (failures.length) errorIn(d, new Error(`${uploaded} fichier(s) enregistré(s). ${failures.join(" ")}`));
        e.target.disabled = false;
        e.target.value = "";
      },
    );
    try {
      await list();
    } catch (error) {
      errorIn(d, error);
    }
  }
  function action(action, id) {
    if (bankUI.action(action, id)) return true;
    if (action === "add-recurrence" || action === "edit-recurrence") {
      recurrenceForm(id);
      return true;
    }
    if (action === "adjust-loan") {
      loanForm(id);
      return true;
    }
    if (action === "partial-payment") {
      paymentForm(id);
      return true;
    }
    if (action === "payments-history") {
      paymentHistory(id);
      return true;
    }
    if (action === "attachments") {
      attachmentDialog(id);
      return true;
    }
    if (action === "settle-batch") {
      batchPayment();
      return true;
    }
    if (action === "pause-recurrence" && allowMutation()) {
      const r = getState().recurrences.find((r) => r.id === id);
      setRecurrenceActive(r, !r.active);
      generateRecurringTransactions(getState());
      persist(
        r.active
          ? "La périodicité est reprise à partir d’aujourd’hui."
          : "La périodicité est en pause. Les échéances déjà créées restent à pointer.",
      );
      return true;
    }
    if (action === "delete-recurrence" && allowMutation()) {
      confirmDialog(
        "Supprimer la périodicité ?",
        "Les opérations déjà créées et leurs règlements seront conservés. Aucune nouvelle échéance ne sera générée.",
        "Supprimer la périodicité",
        d => saveDialog(d, "La périodicité a été supprimée.", () => {
          getState().recurrences = getState().recurrences.filter(
            (r) => r.id !== id,
          );
        }),
      );
      return true;
    }
    return false;
  }
  return {
    render(view, content) {
      if (view === "recurrences") renderRecurrences(content);
      if (view === "pointing") renderPointing(content);
      if (view === "arrears") renderPointing(content, true);
      if (view === "forecast") renderForecast(content);
      if (view === "bank-checks") bankUI.render(content);
    },
    action,
    paymentForm,
    recurrenceForm,
    createFromLease,
  };
}
