export const VERSION = 1;
export const STORAGE_KEY = "atelier.sci.v1";
export const CATEGORIES = [
  { id: "rent", label: "Loyers", type: "income" },
  { id: "recoverable", label: "Provisions sur charges", type: "income" },
  { id: "contribution", label: "Apports / comptes courants", type: "income" },
  { id: "loan_received", label: "Emprunt reçu", type: "income" },
  { id: "deposit_received", label: "Dépôt de garantie reçu", type: "income" },
  { id: "other_income", label: "Autres encaissements", type: "income" },
  { id: "maintenance", label: "Entretien et travaux", type: "expense" },
  { id: "insurance", label: "Assurances", type: "expense" },
  { id: "property_tax", label: "Taxe foncière", type: "expense" },
  { id: "condominium", label: "Copropriété", type: "expense" },
  { id: "loan_payment", label: "Échéance de prêt", type: "expense" },
  { id: "loan_interest", label: "Intérêts d’emprunt", type: "expense" },
  { id: "loan_capital", label: "Capital d’emprunt remboursé", type: "expense" },
  { id: "management", label: "Frais de gestion", type: "expense" },
  {
    id: "deposit_returned",
    label: "Dépôt de garantie restitué",
    type: "expense",
  },
  {
    id: "contribution_returned",
    label: "Remboursement de compte courant",
    type: "expense",
  },
  { id: "other_expense", label: "Autres décaissements", type: "expense" },
];
export const categoryFor = (id) => CATEGORIES.find((c) => c.id === id);
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `sci-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const todayISO = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const money = (cents) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export const shortDate = (date) =>
  validDate(date)
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(`${date}T12:00:00`))
    : "";
export const clean = (value) => (typeof value === "string" ? value.trim() : "");
export const fold = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/œ/g, "oe");
export function validDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
export function parseMoney(value, allowNegative = false) {
  const raw = String(value ?? "")
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "");
  if (
    !(allowNegative ? /^-?\d+(?:[.,]\d{1,2})?$/ : /^\d+(?:[.,]\d{1,2})?$/).test(
      raw,
    )
  )
    return null;
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw
    .replace("-", "")
    .replace(",", ".")
    .split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result <= 1_000_000_000_00
    ? negative
      ? -result
      : result
    : null;
}
export const moneyInput = (cents) => (cents / 100).toFixed(2).replace(".", ",");
const safeCents = (n) =>
  Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000_000_00;
export function createEmptyState(taxRegime = "IS") {
  return {
    version: VERSION,
    mode: "real",
    settings: {
      name: "Ma SCI",
      taxRegime,
      openingDate: `${new Date().getFullYear()}-01-01`,
      openingBalanceCents: 0,
    },
    properties: [],
    transactions: [],
    recurrences: [],
    suppliers: [],
    tenants: [],
    leases: [],
    bankChecks: [],
  };
}
export function createDemoState() {
  const state = createEmptyState();
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  state.mode = "demo";
  state.settings = {
    ...state.settings,
    name: "SCI Les Tilleuls",
    openingBalanceCents: 650000,
  };
  state.properties = [
    {
      id: "demo-1",
      name: "République T2",
      address: "12 avenue de la République · Lyon",
      tenant: "Camille Martin",
      rentCents: 89000,
      chargesCents: 7500,
      archived: false,
    },
    {
      id: "demo-2",
      name: "Tilleuls Studio",
      address: "8 rue des Tilleuls · Lyon",
      tenant: "Alex Dubois",
      rentCents: 59000,
      chargesCents: 4500,
      archived: false,
    },
    {
      id: "demo-3",
      name: "Bellecour Local",
      address: "4 place Bellecour · Lyon",
      tenant: "Atelier Lumière",
      rentCents: 125000,
      chargesCents: 11000,
      archived: false,
    },
  ];
  const tx = (values) => ({
    id: uid(),
    date: `${year}-${String(month).padStart(2, "0")}-05`,
    type: "income",
    status: "paid",
    label: "",
    category: "rent",
    propertyId: "",
    amountCents: 0,
    counterparty: "",
    reference: "",
    notes: "",
    dueDate: "",
    ...values,
  });
  for (let m = 1; m <= month; m++) {
    for (const [i, p] of state.properties.entries()) {
      state.transactions.push(
        tx({
          date: `${year}-${String(m).padStart(2, "0")}-05`,
          label: `Loyer · ${new Date(year, m - 1).toLocaleDateString("fr-FR", { month: "long" })}`,
          propertyId: p.id,
          amountCents: p.rentCents,
          counterparty: p.tenant,
          status: m === month && i === 1 ? "pending" : "paid",
        }),
      );
      state.transactions.push(
        tx({
          date: `${year}-${String(m).padStart(2, "0")}-05`,
          label: "Provision sur charges",
          category: "recoverable",
          propertyId: p.id,
          amountCents: p.chargesCents,
          counterparty: p.tenant,
          status: m === month && i === 1 ? "pending" : "paid",
        }),
      );
    }
    state.transactions.push(
      tx({
        date: `${year}-${String(m).padStart(2, "0")}-10`,
        type: "expense",
        label: "Assurance propriétaire",
        category: "insurance",
        amountCents: 8500,
        counterparty: "Assureur (exemple)",
      }),
    );
    state.transactions.push(
      tx({
        date: `${year}-${String(m).padStart(2, "0")}-12`,
        type: "expense",
        label: "Emprunt · remboursement du capital",
        category: "loan_capital",
        propertyId: "demo-1",
        amountCents: 42000,
      }),
    );
    state.transactions.push(
      tx({
        date: `${year}-${String(m).padStart(2, "0")}-12`,
        type: "expense",
        label: "Emprunt · intérêts",
        category: "loan_interest",
        propertyId: "demo-1",
        amountCents: 11800,
      }),
    );
  }
  state.transactions.push(
    tx({
      date: `${year}-${String(Math.max(1, month - 1)).padStart(2, "0")}-18`,
      type: "expense",
      label: "Réparation de la chaudière",
      category: "maintenance",
      propertyId: "demo-1",
      amountCents: 38500,
      counterparty: "Plomberie Durand (exemple)",
      reference: "FAC-DEMO-042",
    }),
  );
  state.transactions.push(
    tx({
      date: `${year}-${String(month).padStart(2, "0")}-28`,
      type: "expense",
      status: "pending",
      label: "Appel de charges · copropriété",
      category: "condominium",
      propertyId: "demo-2",
      amountCents: 24000,
      counterparty: "Syndic (exemple)",
    }),
  );
  // Des exemples groupés loyer/provisions, sans créer de doublons avec l’historique fictif.
  state.transactions = state.transactions
    .filter((t) => t.category !== "recoverable")
    .map((t) => {
      const p = state.properties.find((p) => p.id === t.propertyId);
      if (t.category === "rent" && p)
        t = {
          ...t,
          rentCents: t.amountCents,
          chargesCents: p.chargesCents,
          amountCents: t.amountCents + p.chargesCents,
        };
      t = {
        ...t,
        normalizedLabel: true,
        period: t.date.slice(0, 7),
        detail: t.category === "rent" ? "" : t.label,
      };
      t.label = transactionLabel(t, state);
      return t;
    });
  const nextMonth = new Date(year, month, 5);
  const startDate = todayISO(nextMonth);
  state.recurrences = state.properties.map(
    (p) =>
      validateRecurrence(
        {
          id: `demo-rule-${p.id}`,
          type: "income",
          category: "rent",
          propertyId: p.id,
          rent: moneyInput(p.rentCents),
          charges: moneyInput(p.chargesCents),
          counterparty: p.tenant,
          frequency: "monthly",
          startDate,
          active: true,
        },
        state,
      ).value,
  );
  return state;
}
// Loan components describe the whole instalment, not individual payment records.
function validateLoanComponents(input, value, errors) {
  const fields = ["capital", "interest", "insurance"];
  const amounts = fields.map((field) =>
    input[field] !== undefined
      ? parseMoney(
          field !== "capital" && typeof input[field] === "string" && !clean(input[field])
            ? "0"
            : input[field],
        )
      : (input[`${field}Cents`] === undefined ? 0 : input[`${field}Cents`]),
  );
  const valid = amounts.every((n) => safeCents(n) && n >= 0);
  if (value.category !== "loan_payment") {
    if (!valid || amounts.some((n) => n !== 0))
      errors.amount = "La ventilation du prêt est réservée aux échéances de prêt.";
    return;
  }
  fields.forEach((field, index) => {
    value[`${field}Cents`] = amounts[index];
  });
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (input.amount === undefined && valid) value.amountCents = total;
  if (!valid || !safeCents(total) || total <= 0 || total !== value.amountCents)
    errors.amount =
      "Le capital, les intérêts et l’assurance doivent être positifs ou nuls et correspondre au montant total du prêt.";
}
// Directory entries remain separate from operation snapshots: changing a contact
// never rewrites the counterparty recorded on an earlier operation.
function directoryContact(input, supplier = false) {
  const value = {
    id: clean(input.id) || uid(), name: clean(input.name),
    email: clean(input.email), phone: clean(input.phone),
    address: clean(input.address), notes: clean(input.notes),
    archived: input.archived === undefined ? false : input.archived,
  };
  const errors = {};
  if (!value.name || value.name.length > 160) errors.name = "Saisissez un nom de 1 à 160 caractères.";
  if (value.id.length > 150) errors.id = "Identifiant trop long.";
  if (value.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254)) errors.email = "Saisissez une adresse e-mail valide.";
  if (value.phone.length > 50) errors.phone = "50 caractères maximum.";
  if (value.address.length > 500) errors.address = "500 caractères maximum.";
  if (value.notes.length > 3000) errors.notes = "3 000 caractères maximum.";
  if (typeof value.archived !== "boolean") errors.archived = "Le statut est invalide.";
  if (supplier) {
    for (const field of ["legalName", "category", "reference", "siret"])
      value[field] = clean(input[field]);
    if (value.legalName.length > 250) errors.legalName = "250 caractères maximum.";
    if (value.reference.length > 100) errors.reference = "100 caractères maximum.";
    if (value.category && categoryFor(value.category)?.type !== "expense") errors.category = "Choisissez une catégorie de dépense valide.";
    value.siret = value.siret.replace(/\s/g, "");
    if (value.siret && !/^\d{14}$/.test(value.siret)) errors.siret = "Le SIRET doit contenir 14 chiffres.";
  }
  return { value, errors };
}
export function validateSupplier(input, state) {
  const result = directoryContact(input, true);
  if ((state?.suppliers || []).some(s => s.id !== result.value.id && fold(s.name) === fold(result.value.name)))
    result.errors.name = "Ce nom court est déjà utilisé par un fournisseur.";
  return result;
}
export function validateTenant(input) {
  return directoryContact(input);
}
export function validateLease(input, state) {
  const value = {
    id: clean(input.id) || uid(), tenantId: clean(input.tenantId), propertyId: clean(input.propertyId),
    startDate: clean(input.startDate), endDate: clean(input.endDate),
    rentCents: input.rent !== undefined ? parseMoney(input.rent) : input.rentCents,
    chargesCents: input.charges !== undefined ? parseMoney(input.charges || "0") : (input.chargesCents ?? 0),
    depositCents: input.deposit !== undefined ? parseMoney(input.deposit || "0") : (input.depositCents ?? 0),
    paymentDay: Number(input.paymentDay ?? 1), notes: clean(input.notes),
  };
  const errors = {};
  if (value.id.length > 150) errors.id = "Identifiant trop long.";
  if (!(state?.tenants || []).some(t => t.id === value.tenantId)) errors.tenantId = "Choisissez un locataire existant.";
  if (!state?.properties.some(p => p.id === value.propertyId)) errors.propertyId = "Choisissez un bien existant.";
  if (!validDate(value.startDate)) errors.startDate = "Choisissez une date d’entrée valide.";
  if (value.endDate && (!validDate(value.endDate) || value.endDate < value.startDate)) errors.endDate = "La sortie doit suivre ou égaler l’entrée.";
  for (const [field, cents] of [["rent", "rentCents"], ["charges", "chargesCents"], ["deposit", "depositCents"]])
    if (!safeCents(value[cents]) || value[cents] < 0) errors[field] = "Saisissez un montant positif ou nul avec au plus 2 décimales.";
  if (!Number.isInteger(value.paymentDay) || value.paymentDay < 1 || value.paymentDay > 31) errors.paymentDay = "Choisissez un jour entre 1 et 31.";
  if (value.notes.length > 3000) errors.notes = "3 000 caractères maximum.";
  if (!errors.startDate && !errors.endDate && (state?.leases || []).some(l =>
    l.id !== value.id && l.propertyId === value.propertyId &&
    l.startDate <= (value.endDate || "9999-12-31") && value.startDate <= (l.endDate || "9999-12-31")))
    errors.startDate = "Une autre location occupe déjà ce bien sur cette période. Renseignez d’abord sa date de sortie.";
  const previous = state?.leases?.find(l => l.id === value.id);
  if (previous) {
    if (previous.tenantId !== value.tenantId) errors.tenantId = "Conservez le locataire de cette location. Pour un changement d’occupant, créez une nouvelle location.";
    if (previous.propertyId !== value.propertyId) errors.propertyId = "Conservez le bien de cette location. Pour un autre bien, créez une nouvelle location.";
  }
  return { value, errors };
}
export function validateBankCheck(input, state, { allowBeforeOpening = false } = {}) {
  const value = { id: clean(input.id) || uid(), date: clean(input.date),
    balanceCents: input.balance !== undefined ? parseMoney(input.balance, true) : input.balanceCents,
    notes: clean(input.notes) };
  const errors = {};
  if (value.id.length > 150) errors.id = "Identifiant trop long.";
  if (!validDate(value.date) || (!allowBeforeOpening && state?.settings?.openingDate && value.date < state.settings.openingDate)) errors.date = "Choisissez une date à partir du solde initial.";
  if (!safeCents(value.balanceCents)) errors.balance = "Saisissez un solde valide avec au plus 2 décimales.";
  if (value.notes.length > 3000) errors.notes = "3 000 caractères maximum.";
  if ((state?.bankChecks || []).some(c => c.id !== value.id && c.date === value.date)) errors.date = "Un contrôle existe déjà à cette date. Modifiez-le.";
  return { value, errors };
}
export function bankBalanceAt(state, date) {
  if (!validDate(date)) throw new Error("La date du contrôle est invalide.");
  if (date < state.settings.openingDate) return null;
  return state.settings.openingBalanceCents + state.transactions.reduce((sum, t) => sum +
    getPayments(t).filter(p => p.date >= state.settings.openingDate && p.date <= date)
      .reduce((n,p) => n + (t.type === "income" ? p.amountCents : -p.amountCents), 0), 0);
}
function validateDirectoryLinks(input, value, errors, state) {
  for (const [field, list] of [["supplierId", "suppliers"], ["tenantId", "tenants"], ["leaseId", "leases"]]) {
    if (input[field] === undefined) continue;
    value[field] = clean(input[field]);
    if (typeof input[field] !== "string" || (value[field] && !(state[list] || []).some(item => item.id === value[field])))
      errors[field] = "Cette fiche est introuvable.";
  }
  if (value.supplierId && (value.tenantId || value.leaseId)) errors.supplierId = "Choisissez un fournisseur ou un locataire pour cette opération.";
  if (value.leaseId) {
    const lease = state.leases?.find(l => l.id === value.leaseId);
    if (lease && (lease.propertyId !== value.propertyId || lease.tenantId !== value.tenantId))
      errors.leaseId = "La location doit correspondre au bien et au locataire sélectionnés.";
  }
  if (input.documentNotRequired !== undefined) {
    value.documentNotRequired = input.documentNotRequired;
    if (typeof value.documentNotRequired !== "boolean") errors.documentNotRequired = "Le choix du justificatif est invalide.";
  }
}
function leaseRecurrenceDates(state, rule, from, to) {
  const lease = state.leases?.find(l => l.id === rule.leaseId);
  if (!lease) return recurrenceDates(rule, from, to);
  // Bound the interval, not the rule anchor: a payment due on the 31st
  // must remain due on the 31st even if a lease starts on the 10th.
  return recurrenceDates(rule, from > lease.startDate ? from : lease.startDate,
    lease.endDate && lease.endDate < to ? lease.endDate : to);
}
export function validateTransaction(input, state) {
  const value = {
    id: clean(input.id) || uid(),
    date: clean(input.date),
    dueDate: clean(input.dueDate),
    type: input.type,
    status: input.status,
    label: clean(input.label),
    category: input.category,
    propertyId: clean(input.propertyId),
    amountCents: parseMoney(input.amount),
    counterparty: clean(input.counterparty),
    reference: clean(input.reference),
    notes: clean(input.notes),
  };
  const errors = {};
  validateDirectoryLinks(input, value, errors, state);
  if (input.normalizedLabel !== undefined) {
    value.normalizedLabel = input.normalizedLabel === true;
    if (typeof input.normalizedLabel !== "boolean")
      errors.normalizedLabel = "Le format du libellé est invalide.";
  }
  if (input.period !== undefined || value.normalizedLabel)
    value.period = clean(input.period) || value.date.slice(0, 7);
  if (input.detail !== undefined) value.detail = clean(input.detail);
  if (input.recurrenceId !== undefined)
    value.recurrenceId = clean(input.recurrenceId);
  if (input.occurrenceDate !== undefined)
    value.occurrenceDate = clean(input.occurrenceDate);
  if (value.period && !validPeriod(value.period))
    errors.period = "Choisissez une période valide.";
  if ((value.detail || "").length > 160)
    errors.detail = "160 caractères maximum.";
  if (
    value.recurrenceId &&
    (!validDate(value.occurrenceDate) || value.recurrenceId.length > 150)
  )
    errors.recurrenceId = "La récurrence de cette opération est invalide.";
  if (value.occurrenceDate && !value.recurrenceId)
    errors.occurrenceDate = "La récurrence de cette opération est invalide.";
  if (
    input.rent !== undefined ||
    input.charges !== undefined ||
    input.rentCents !== undefined ||
    input.chargesCents !== undefined
  ) {
    value.rentCents =
      input.rent !== undefined
        ? parseMoney(input.rent)
        : (input.rentCents ?? value.amountCents);
    value.chargesCents =
      input.charges !== undefined
        ? parseMoney(input.charges)
        : (input.chargesCents ?? 0);
    if (
      input.amount === undefined &&
      value.category === "rent" &&
      safeCents(value.rentCents) &&
      safeCents(value.chargesCents)
    )
      value.amountCents = value.rentCents + value.chargesCents;
    if (
      !safeCents(value.rentCents) ||
      value.rentCents < 0 ||
      !safeCents(value.chargesCents) ||
      value.chargesCents < 0 ||
      (value.category === "rent"
        ? value.rentCents + value.chargesCents !== value.amountCents
        : value.rentCents !== 0 || value.chargesCents !== 0)
    )
      errors.amount =
        "La ventilation du loyer et des provisions doit correspondre au montant total.";
  }
  validateLoanComponents(input, value, errors);
  if (input.payments !== undefined) {
    const result = validatePayments(input.payments, value);
    if (result.error) errors.payments = result.error;
    else {
      value.payments = result.value;
      value.status =
        result.value.reduce((n, p) => n + p.amountCents, 0) ===
        value.amountCents
          ? "paid"
          : "pending";
    }
  }
  if (value.normalizedLabel) value.label = transactionLabel(value, state);
  if (!value.label || value.label.length > (value.normalizedLabel ? 400 : 160))
    errors.label = "Saisissez un libellé de 1 à 160 caractères.";
  if (!validDate(value.date)) errors.date = "Choisissez une date valide.";
  if (value.dueDate && !validDate(value.dueDate))
    errors.dueDate = "L’échéance initiale est invalide.";
  if (!["income", "expense"].includes(value.type))
    errors.type = "Choisissez un type valide.";
  if (!["paid", "pending"].includes(value.status))
    errors.status = "Choisissez un statut valide.";
  if (categoryFor(value.category)?.type !== value.type)
    errors.category = "Choisissez une catégorie adaptée au type.";
  if (value.amountCents === null || value.amountCents <= 0)
    errors.amount =
      "Saisissez un montant positif, avec au maximum 2 décimales.";
  if (
    value.propertyId &&
    !state.properties.some((p) => p.id === value.propertyId)
  )
    errors.propertyId = "Ce bien est introuvable.";
  if (value.counterparty.length > 160)
    errors.counterparty = "160 caractères maximum.";
  if (value.reference.length > 100)
    errors.reference = "100 caractères maximum.";
  if (value.notes.length > 3000) errors.notes = "3 000 caractères maximum.";
  const previous = state.transactions?.find((t) => t.id === value.id);
  if (previous && getPayments(previous).length) {
    for (const field of ["type", "category", "propertyId", "amountCents"])
      if (previous[field] !== value[field])
        errors.amount =
          "Une opération déjà pointée doit conserver son montant, son bien et sa catégorie.";
    if (
      (previous.rentCents ??
        (previous.category === "rent" ? previous.amountCents : 0)) !==
        (value.rentCents ??
          (value.category === "rent" ? value.amountCents : 0)) ||
      (previous.chargesCents ?? 0) !== (value.chargesCents ?? 0)
    )
      errors.amount =
        "La ventilation d’une opération déjà pointée ne peut pas être modifiée.";
  }
  return { value, errors };
}
export function validateProperty(input, state, excludeId = input.id) {
  const value = {
    id: clean(input.id) || uid(),
    name: clean(input.name),
    address: clean(input.address),
    tenant: clean(input.tenant),
    rentCents: parseMoney(input.rent || "0"),
    chargesCents: parseMoney(input.charges || "0"),
    archived: input.archived === true,
  };
  const errors = {};
  if (!value.name || value.name.length > 100)
    errors.name = "Saisissez un nom de 1 à 100 caractères.";
  if (
    state?.properties.some(
      (p) => p.id !== excludeId && fold(p.name) === fold(value.name),
    )
  )
    errors.name = "Ce nom court est déjà utilisé par un autre bien.";
  if (value.address.length > 250) errors.address = "250 caractères maximum.";
  if (value.tenant.length > 160) errors.tenant = "160 caractères maximum.";
  if (value.rentCents === null)
    errors.rent = "Saisissez un loyer valide, avec 2 décimales maximum.";
  if (value.chargesCents === null)
    errors.charges = "Saisissez des charges valides, avec 2 décimales maximum.";
  return { value, errors };
}
export function validateSettings(input) {
  const value = {
    name: clean(input.name),
    taxRegime: input.taxRegime,
    openingDate: clean(input.openingDate),
    openingBalanceCents: parseMoney(input.openingBalance, true),
  };
  const errors = {};
  if (!value.name || value.name.length > 100)
    errors.name = "Saisissez le nom de votre SCI (100 caractères maximum).";
  if (!["unknown", "IR", "IS"].includes(value.taxRegime))
    errors.taxRegime = "Choisissez un régime valide.";
  if (!validDate(value.openingDate))
    errors.openingDate = "Choisissez une date valide.";
  if (value.openingBalanceCents === null)
    errors.openingBalance =
      "Saisissez un montant valide (2 décimales maximum).";
  return { value, errors };
}
export function filterTransactions(
  state,
  {
    year = "all",
    propertyId = "all",
    status = "all",
    category = "all",
    query = "",
  } = {},
) {
  const needle = fold(query).trim();
  return state.transactions
    .filter(
      (t) =>
        (year === "all" ||
          t.date.slice(0, 4) === String(year) ||
          getPayments(t).some((p) => p.date.slice(0, 4) === String(year))) &&
        (propertyId === "all" || t.propertyId === propertyId) &&
        (status === "all" ||
          (status === "paid"
            ? remainingCents(t) === 0
            : status === "pending"
              ? remainingCents(t) > 0
              : transactionStatus(t) === status)) &&
        (category === "all" || t.category === category) &&
        (!needle ||
          fold(
            `${transactionLabel(t, state)} ${t.detail || ""} ${t.period || ""} ${t.counterparty} ${t.reference} ${t.notes} ${state.properties.find((p) => p.id === t.propertyId)?.name || ""} ${categoryFor(t.category)?.label || ""}`,
          ).includes(needle)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export function getSummary(
  state,
  {
    year = new Date().getFullYear(),
    propertyId = "all",
    today = todayISO(),
  } = {},
) {
  const end = `${year}-12-31`;
  const asOf = today < end ? today : end;
  const period = filterTransactions(state, { year, propertyId });
  const scoped = state.transactions.filter(
    (t) => propertyId === "all" || t.propertyId === propertyId,
  );
  const rows = scoped.flatMap((t) =>
    getPayments(t)
      .filter((p) => p.date.slice(0, 4) === String(year) && p.date <= asOf)
      .map((p) => ({ t, p })),
  );
  const income = rows
    .filter((r) => r.t.type === "income")
    .reduce((n, r) => n + r.p.amountCents, 0);
  const expense = rows
    .filter((r) => r.t.type === "expense")
    .reduce((n, r) => n + r.p.amountCents, 0);
  const rent = rows
    .filter((r) => r.t.category === "rent")
    .reduce((n, r) => n + r.p.rentCents, 0);
  const pending = period.filter(
    (t) => remainingCents(t) > 0 && t.date.slice(0, 4) === String(year),
  );
  const pendingIncome = pending
    .filter((t) => t.type === "income")
    .reduce((n, t) => n + remainingCents(t), 0);
  const pendingExpense = pending
    .filter((t) => t.type === "expense")
    .reduce((n, t) => n + remainingCents(t), 0);
  const overdue = pending.filter((t) => (t.dueDate || t.date) < today);
  const balanceFlows = state.transactions.reduce(
    (total, t) =>
      total +
      getPayments(t)
        .filter((p) => p.date >= state.settings.openingDate && p.date <= asOf)
        .reduce(
          (n, p) => n + (t.type === "income" ? p.amountCents : -p.amountCents),
          0,
        ),
    0,
  );
  const balanceAvailable = asOf >= state.settings.openingDate;
  const balance =
    propertyId === "all"
      ? balanceAvailable
        ? state.settings.openingBalanceCents + balanceFlows
        : null
      : income - expense;
  const monthly = Array.from({ length: 12 }, (_, m) => ({
    month: m + 1,
    label: new Date(2024, m, 1).toLocaleDateString("fr-FR", { month: "short" }),
    income: 0,
    expense: 0,
  }));
  rows.forEach(
    ({ t, p }) =>
      (monthly[Number(p.date.slice(5, 7)) - 1][t.type] += p.amountCents),
  );
  return {
    income,
    expense,
    rent,
    pendingIncome,
    pendingExpense,
    overdue,
    balance,
    balanceAvailable,
    asOf,
    monthly,
    count: period.length,
  };
}
export function serializeBackup(state) {
  return JSON.stringify(
    { ...state, exportedAt: new Date().toISOString() },
    null,
    2,
  );
}
export function parseBackup(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("Ce fichier ne contient pas un JSON valide.");
  }
  const fail = (message) => {
    throw new Error(message);
  };
  if (
    !data ||
    data.version !== VERSION ||
    !["demo", "real"].includes(data.mode) ||
    !Array.isArray(data.properties) ||
    !Array.isArray(data.transactions) ||
    !data.settings
  )
    fail("Le format de cette sauvegarde Cap SCI n’est pas reconnu.");
  if (data.properties.length > 1000 || data.transactions.length > 20000)
    fail(
      "Cette sauvegarde dépasse la capacité de cette version (1 000 biens ou 20 000 opérations).",
    );
  const settingsResult = validateSettings({
    ...data.settings,
    openingBalance: moneyInput(data.settings.openingBalanceCents),
  });
  if (
    !safeCents(data.settings.openingBalanceCents) ||
    Object.keys(settingsResult.errors).length
  )
    fail("Les paramètres de la sauvegarde sont invalides.");
  const state = {
    version: VERSION,
    mode: data.mode,
    settings: settingsResult.value,
    properties: [],
    transactions: [],
    recurrences: [],
    suppliers: [],
    tenants: [],
    leases: [],
    bankChecks: [],
  };
  const ids = new Set();
  for (const p of data.properties) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      ids.has(p.id) ||
      !safeCents(p.rentCents) ||
      p.rentCents < 0 ||
      !safeCents(p.chargesCents) ||
      p.chargesCents < 0 ||
      typeof p.archived !== "boolean"
    )
      fail("Un bien de la sauvegarde est invalide ou dupliqué.");
    const result = validateProperty({
      ...p,
      rent: moneyInput(p.rentCents),
      charges: moneyInput(p.chargesCents),
    });
    if (Object.keys(result.errors).length)
      fail("Un bien de la sauvegarde est invalide.");
    ids.add(p.id);
    state.properties.push(result.value);
  }
  for (const [key, validate, max] of [
    ["suppliers", validateSupplier, 5000], ["tenants", validateTenant, 5000],
    ["leases", validateLease, 10000], ["bankChecks", validateBankCheck, 5000],
  ]) {
    const entries = data[key] === undefined ? [] : data[key];
    if (!Array.isArray(entries) || entries.length > max) fail(`La liste ${key} est invalide ou trop longue.`);
    ids.clear();
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id))
        fail(`Une fiche ${key} est invalide ou dupliquée.`);
      if (["suppliers", "tenants"].includes(key) && typeof entry.archived !== "boolean") fail(`Le statut d’une fiche ${key} est invalide.`);
      if (key === "leases" && (["rentCents", "chargesCents", "depositCents"].some(field => !safeCents(entry[field]) || entry[field] < 0) || !Number.isInteger(entry.paymentDay)))
        fail("Les montants ou le jour d’échéance d’une location sont invalides.");
      if (key === "bankChecks" && !safeCents(entry.balanceCents)) fail("Un solde de contrôle est invalide.");
      // Moving the opening balance date must not discard older recorded
      // statement balances; their comparison simply becomes unavailable.
      const result = key === "bankChecks"
        ? validateBankCheck(entry, state, { allowBeforeOpening: true })
        : validate(entry, state);
      if (Object.keys(result.errors).length) fail(`Une fiche ${key} est invalide : ${Object.values(result.errors).join(" ")}`);
      ids.add(entry.id);
      state[key].push(result.value);
    }
  }
  ids.clear();
  for (const t of data.transactions) {
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id ||
      ids.has(t.id) ||
      !safeCents(t.amountCents) ||
      t.amountCents <= 0
    )
      fail("Une opération de la sauvegarde est invalide ou dupliquée.");
    const result = validateTransaction(
      { ...t, amount: moneyInput(t.amountCents) },
      state,
    );
    if (Object.keys(result.errors).length)
      fail(
        "Une opération de la sauvegarde est invalide ou référence un bien absent.",
      );
    ids.add(t.id);
    state.transactions.push(result.value);
  }
  if (data.recurrences !== undefined) {
    if (!Array.isArray(data.recurrences) || data.recurrences.length > 500)
      fail("La liste des opérations périodiques est invalide (500 maximum).");
    ids.clear();
    for (const rule of data.recurrences) {
      if (
        !rule ||
        typeof rule.id !== "string" ||
        !rule.id ||
        ids.has(rule.id) ||
        !safeCents(rule.amountCents) ||
        rule.amountCents <= 0 ||
        typeof rule.active !== "boolean"
      )
        fail("Une opération périodique est invalide ou dupliquée.");
      const result = validateRecurrence(
        { ...rule, amount: moneyInput(rule.amountCents) },
        state,
      );
      if (Object.keys(result.errors).length)
        fail("Une opération périodique est invalide.");
      ids.add(rule.id);
      state.recurrences.push(result.value);
    }
  }
  const occurrences = new Set();
  for (const t of state.transactions)
    if (t.recurrenceId) {
      const key = `${t.recurrenceId}:${t.occurrenceDate}`;
      if (occurrences.has(key)) fail("Une échéance périodique est dupliquée.");
      occurrences.add(key);
    }
  return state;
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportCSV(state, transactions, { year = "all" } = {}) {
  const rows = [
    [
      "Date",
      "Échéance initiale",
      "Libellé",
      "Bien",
      "Catégorie",
      "Type",
      "Statut",
      "Encaissement EUR",
      "Décaissement EUR",
      "Tiers",
      "Référence",
      "Notes",
      "Période",
      "Attendu EUR",
      "Réglé EUR",
      "Reste EUR",
      "Loyer réglé EUR",
      "Provisions réglées EUR",
      "Capital prévu du prêt EUR",
      "Intérêts prévus du prêt EUR",
      "Assurance prévue du prêt EUR",
    ],
  ];
  for (const t of transactions) {
    const payments = getPayments(t);
    let entries;
    if (year === "all") entries = payments.length ? payments : [null];
    else {
      entries = payments.filter((p) => p.date.slice(0, 4) === String(year));
      const due = t.occurrenceDate || t.dueDate || t.date;
      if (remainingCents(t) > 0 && due.slice(0, 4) === String(year))
        entries.push(null);
    }
    const pendingEntryIncluded = entries.includes(null);
    for (const [index, p] of entries.entries())
      rows.push([
        p?.date || t.date,
        t.dueDate || t.occurrenceDate || "",
        transactionLabel(t, state),
        state.properties.find((item) => item.id === t.propertyId)?.name ||
          "SCI / Général",
        categoryFor(t.category).label,
        t.type === "income" ? "Encaissement" : "Décaissement",
        {
          paid: "Réglée",
          partial: "Partiellement réglée",
          overdue: "En retard",
          pending: "En attente",
        }[transactionStatus(t)],
        t.type === "income" ? moneyInput(p?.amountCents ?? 0) : "",
        t.type === "expense" ? moneyInput(p?.amountCents ?? 0) : "",
        t.counterparty,
        t.reference,
        t.notes,
        t.period || "",
        index === 0 ? moneyInput(t.amountCents) : "",
        moneyInput(p?.amountCents ?? 0),
        p === null || (!pendingEntryIncluded && index === 0)
          ? moneyInput(remainingCents(t))
          : "",
        moneyInput(p?.rentCents ?? 0),
        moneyInput(p?.chargesCents ?? 0),
        ...["capitalCents", "interestCents", "insuranceCents"].map((field) =>
          index === 0 && t.category === "loan_payment" ? moneyInput(t[field]) : "",
        ),
      ]);
  }
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

const validPeriod = (value) =>
  typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
const recurrenceSteps = { monthly: 1, quarterly: 3, yearly: 12 };
const shiftDay = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export function monthEnd(date = todayISO()) {
  if (!validDate(date)) throw new Error("Date invalide.");
  const [year, month] = date.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
}
export function transactionLabel(t, state) {
  if (!t.normalizedLabel) return t.label || "";
  const type = t.type === "income" ? "Encaissement" : "Décaissement";
  const property =
    state.properties.find((p) => p.id === t.propertyId)?.name ||
    "SCI / Général";
  const category =
    t.category === "rent"
      ? "Loyer et provisions"
      : categoryFor(t.category)?.label || t.category;
  const period = validPeriod(t.period)
    ? new Date(`${t.period}-01T12:00:00Z`).toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  return [type, property, category, period, clean(t.detail)]
    .filter(Boolean)
    .join(" · ");
}
function components(t) {
  return t.category === "rent"
    ? {
        rentCents: t.rentCents ?? t.amountCents,
        chargesCents: t.chargesCents ?? 0,
      }
    : { rentCents: 0, chargesCents: 0 };
}
function validatePayments(payments, t) {
  if (!Array.isArray(payments) || payments.length > 1000)
    return { error: "La liste des règlements est invalide (1 000 maximum)." };
  const ids = new Set();
  const value = [];
  let total = 0,
    rent = 0,
    charges = 0;
  for (const payment of payments) {
    if (
      !payment ||
      typeof payment.id !== "string" ||
      !payment.id ||
      payment.id.length > 180 ||
      ids.has(payment.id) ||
      !validDate(payment.date) ||
      !safeCents(payment.amountCents) ||
      payment.amountCents <= 0 ||
      !safeCents(payment.rentCents) ||
      payment.rentCents < 0 ||
      !safeCents(payment.chargesCents) ||
      payment.chargesCents < 0
    )
      return { error: "Un règlement est invalide ou dupliqué." };
    if (
      t.category === "rent"
        ? payment.rentCents + payment.chargesCents !== payment.amountCents
        : payment.rentCents !== 0 || payment.chargesCents !== 0
    )
      return { error: "La ventilation d’un règlement est incohérente." };
    ids.add(payment.id);
    total += payment.amountCents;
    rent += payment.rentCents;
    charges += payment.chargesCents;
    value.push({
      id: payment.id,
      date: payment.date,
      amountCents: payment.amountCents,
      rentCents: payment.rentCents,
      chargesCents: payment.chargesCents,
    });
  }
  const target = components(t);
  if (
    total > t.amountCents ||
    rent > target.rentCents ||
    charges > target.chargesCents
  )
    return {
      error:
        "Les règlements dépassent le montant ou la ventilation de l’échéance.",
    };
  return { value };
}
export function getPayments(t) {
  if (Array.isArray(t.payments)) return t.payments;
  return t.status === "paid"
    ? [
        {
          id: `${t.id}:legacy`,
          date: t.date,
          amountCents: t.amountCents,
          ...components(t),
        },
      ]
    : [];
}
export const paidCents = (t) =>
  getPayments(t).reduce((n, p) => n + p.amountCents, 0);
export const remainingCents = (t) => Math.max(0, t.amountCents - paidCents(t));
export function transactionStatus(t, today = todayISO()) {
  const remaining = remainingCents(t);
  if (remaining === 0) return "paid";
  if (paidCents(t) > 0) return "partial";
  return (t.dueDate || t.date) < today ? "overdue" : "pending";
}
export function suggestedAllocation(t, amountCents) {
  const remaining = remainingCents(t);
  if (!safeCents(amountCents) || amountCents < 0 || amountCents > remaining)
    throw new Error(
      "Le montant doit être compris entre zéro et le reste à régler.",
    );
  if (t.category !== "rent" || amountCents === 0)
    return { rentCents: 0, chargesCents: 0 };
  const previous = getPayments(t);
  const target = components(t);
  const rentLeft =
    target.rentCents - previous.reduce((n, p) => n + p.rentCents, 0);
  const chargesLeft =
    target.chargesCents - previous.reduce((n, p) => n + p.chargesCents, 0);
  let rent = Number(
    (BigInt(amountCents) * BigInt(rentLeft) + BigInt(remaining) / 2n) /
      BigInt(remaining),
  );
  rent = Math.min(rentLeft, Math.max(amountCents - chargesLeft, rent));
  return { rentCents: rent, chargesCents: amountCents - rent };
}
export function recordPayment(
  state,
  id,
  { date, amount, rentAmount, chargesAmount } = {},
) {
  const index = state.transactions.findIndex((t) => t.id === id);
  if (index < 0) throw new Error("Opération introuvable.");
  const t = state.transactions[index];
  const cents = parseMoney(amount);
  const remaining = remainingCents(t);
  if (!validDate(date))
    throw new Error("Choisissez une date de règlement valide.");
  if (cents === null || cents <= 0 || cents > remaining)
    throw new Error(
      "Le règlement doit être positif et ne pas dépasser le reste à régler.",
    );
  const previous = getPayments(t);
  const totals = components(t);
  const remainingRent =
    totals.rentCents - previous.reduce((n, p) => n + p.rentCents, 0);
  const remainingCharges =
    totals.chargesCents - previous.reduce((n, p) => n + p.chargesCents, 0);
  let rent = 0,
    charges = 0;
  if (t.category === "rent") {
    if (rentAmount !== undefined || chargesAmount !== undefined) {
      rent = parseMoney(rentAmount);
      charges = parseMoney(chargesAmount);
      if (
        rent === null ||
        charges === null ||
        rent + charges !== cents ||
        rent > remainingRent ||
        charges > remainingCharges
      )
        throw new Error(
          "La ventilation doit correspondre au règlement sans dépasser le loyer ou les provisions restant dus.",
        );
    } else {
      const allocation = suggestedAllocation(t, cents);
      rent = allocation.rentCents;
      charges = allocation.chargesCents;
    }
  }
  const next = {
    ...t,
    payments: [
      ...previous,
      {
        id: uid(),
        date,
        amountCents: cents,
        rentCents: rent,
        chargesCents: charges,
      },
    ],
    dueDate: t.dueDate || t.occurrenceDate || t.date,
  };
  next.status = paidCents(next) === t.amountCents ? "paid" : "pending";
  state.transactions[index] = next;
  return next;
}
export function recordPaymentsBatch(state, ids, date) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw new Error("Sélectionnez des opérations distinctes.");
  const draft = {
    ...state,
    transactions: state.transactions.map((t) => ({
      ...t,
      payments: Array.isArray(t.payments)
        ? t.payments.map((p) => ({ ...p }))
        : undefined,
    })),
  };
  // Keep absence of explicit payments on legacy paid records.
  draft.transactions.forEach((t, i) => {
    if (state.transactions[i].payments === undefined) delete t.payments;
  });
  for (const id of ids) {
    const t = draft.transactions.find((t) => t.id === id);
    if (!t || remainingCents(t) === 0)
      throw new Error("Une opération sélectionnée est absente ou déjà réglée.");
    recordPayment(draft, id, { date, amount: moneyInput(remainingCents(t)) });
  }
  state.transactions = draft.transactions;
  return ids.length;
}
export function validateRecurrence(input, state) {
  const value = {
    id: clean(input.id) || uid(),
    label: clean(input.label),
    detail: clean(input.detail),
    type: input.type,
    category: input.category,
    propertyId: clean(input.propertyId),
    amountCents: parseMoney(input.amount),
    rentCents: 0,
    chargesCents: 0,
    counterparty: clean(input.counterparty),
    reference: clean(input.reference),
    notes: clean(input.notes),
    frequency: input.frequency,
    startDate: clean(input.startDate),
    endDate: clean(input.endDate),
    active: input.active === undefined ? true : input.active,
    generatedThrough: clean(input.generatedThrough),
  };
  const errors = {};
  if (input.paymentDay !== undefined) {
    value.paymentDay = Number(input.paymentDay);
    if (!Number.isInteger(value.paymentDay) || value.paymentDay < 1 || value.paymentDay > 31)
      errors.paymentDay = "Choisissez un jour entre 1 et 31.";
  }
  validateDirectoryLinks(input, value, errors, state);
  if (
    value.category !== "rent" &&
    ((input.rentCents !== undefined && input.rentCents !== 0) ||
      (input.chargesCents !== undefined && input.chargesCents !== 0))
  )
    errors.amount =
      "Une opération hors loyer ne doit pas contenir de ventilation locative.";
  if (value.type === "income" && value.category === "rent") {
    const hasSplit =
      input.rent !== undefined ||
      input.charges !== undefined ||
      input.rentCents !== undefined ||
      input.chargesCents !== undefined;
    value.rentCents =
      input.rent !== undefined
        ? parseMoney(input.rent)
        : (input.rentCents ?? value.amountCents);
    value.chargesCents =
      input.charges !== undefined
        ? parseMoney(input.charges)
        : (input.chargesCents ?? 0);
    if (hasSplit && input.amount === undefined)
      value.amountCents = value.rentCents + value.chargesCents;
    if (
      !safeCents(value.rentCents) ||
      value.rentCents < 0 ||
      !safeCents(value.chargesCents) ||
      value.chargesCents < 0 ||
      value.rentCents + value.chargesCents !== value.amountCents
    )
      errors.amount =
        "Le loyer et les provisions doivent correspondre au montant total.";
  }
  validateLoanComponents(input, value, errors);
  if (value.amountCents === null || value.amountCents <= 0)
    errors.amount =
      "Saisissez un montant positif, avec au maximum 2 décimales.";
  if (!["income", "expense"].includes(value.type))
    errors.type = "Choisissez un type valide.";
  if (categoryFor(value.category)?.type !== value.type)
    errors.category = "Choisissez une catégorie adaptée au type.";
  if (
    value.propertyId &&
    !state.properties.some((p) => p.id === value.propertyId)
  )
    errors.propertyId = "Ce bien est introuvable.";
  if (!Object.hasOwn(recurrenceSteps, value.frequency))
    errors.frequency = "Choisissez une fréquence valide.";
  if (!validDate(value.startDate) || value.startDate < "1900-01-01")
    errors.startDate = "Choisissez une date de début valide, à partir de 1900.";
  if (
    value.endDate &&
    (!validDate(value.endDate) || value.endDate < value.startDate)
  )
    errors.endDate = "La date de fin doit suivre ou égaler la date de début.";
  if (typeof value.active !== "boolean")
    errors.active = "Le statut de la récurrence est invalide.";
  if (value.generatedThrough && !validDate(value.generatedThrough))
    errors.generatedThrough = "La date de génération est invalide.";
  if (value.id.length > 150) errors.id = "Identifiant trop long.";
  if (value.detail.length > 160) errors.detail = "160 caractères maximum.";
  if (value.counterparty.length > 160)
    errors.counterparty = "160 caractères maximum.";
  if (value.reference.length > 100)
    errors.reference = "100 caractères maximum.";
  if (value.notes.length > 3000) errors.notes = "3 000 caractères maximum.";
  if (value.label.length > 400) errors.label = "Libellé trop long.";
  return { value, errors };
}
export function recurrenceDates(rule, from, to) {
  if (
    !validDate(rule.startDate) ||
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    !Object.hasOwn(recurrenceSteps, rule.frequency)
  )
    return [];
  const start = rule.startDate;
  const lower = from > start ? from : start;
  const upper = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (lower > upper) return [];
  const [year, month, startDay] = start.split("-").map(Number);
  const day = rule.paymentDay ?? startDay;
  if (!Number.isInteger(day) || day < 1 || day > 31) return [];
  const [fy, fm] = lower.split("-").map(Number);
  const step = recurrenceSteps[rule.frequency];
  let index = Math.max(0, Math.floor(((fy - year) * 12 + fm - month) / step));
  const dates = [];
  for (; index < 120000; index++) {
    const absolute = year * 12 + month - 1 + index * step;
    const y = Math.floor(absolute / 12);
    const m = (absolute % 12) + 1;
    if (y > 9999) break;
    const occurrence = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, "0")}`;
    if (occurrence > upper) break;
    if (occurrence >= lower) dates.push(occurrence);
    if (dates.length > 20000)
      throw new Error("La période comporte trop d’échéances.");
  }
  return dates;
}
export function nextRecurrenceDate(rule, from = todayISO()) {
  if (!rule.active || !validDate(from)) return "";
  const end =
    rule.endDate ||
    `${Math.min(9999, Math.max(Number(from.slice(0, 4)), Number(rule.startDate.slice(0, 4))) + 2)}-12-31`;
  return recurrenceDates(rule, from, end)[0] || "";
}
export function setRecurrenceActive(rule, active, today = todayISO()) {
  if (typeof active !== "boolean" || !validDate(today))
    throw new Error("Statut ou date invalide.");
  if (active && !rule.active) {
    const cutoff = shiftDay(today, -1);
    if (!rule.generatedThrough || rule.generatedThrough < cutoff)
      rule.generatedThrough = cutoff;
  }
  rule.active = active;
  return rule;
}
export function generateRecurringTransactions(
  state,
  through = monthEnd(todayISO()),
) {
  if (!validDate(through))
    throw new Error("La date de génération est invalide.");
  const additions = [];
  const updates = [];
  const occurrences = new Set(
    state.transactions
      .filter((t) => t.recurrenceId)
      .map((t) => `${t.recurrenceId}:${t.occurrenceDate}`),
  );
  const ids = new Set(state.transactions.map((t) => t.id));
  for (const rule of state.recurrences || []) {
    if (
      !rule.active ||
      (rule.generatedThrough && rule.generatedThrough >= through)
    )
      continue;
    const from = rule.generatedThrough
      ? shiftDay(rule.generatedThrough, 1)
      : rule.startDate;
    for (const date of leaseRecurrenceDates(state, rule, from, through)) {
      const key = `${rule.id}:${date}`;
      if (occurrences.has(key)) continue;
      const id = `rec:${key}`;
      if (ids.has(id))
        throw new Error("Un identifiant d’échéance est déjà utilisé.");
      const t = {
        id,
        date,
        dueDate: date,
        type: rule.type,
        status: "pending",
        label: "",
        category: rule.category,
        propertyId: rule.propertyId,
        amountCents: rule.amountCents,
        counterparty: rule.counterparty,
        reference: rule.reference || "",
        notes: rule.notes || "",
        ...Object.fromEntries(["supplierId", "tenantId", "leaseId", "documentNotRequired"]
          .filter(field => rule[field] !== undefined).map(field => [field, rule[field]])),
        ...(rule.category === "loan_payment"
          ? {
              capitalCents: rule.capitalCents,
              interestCents: rule.interestCents,
              insuranceCents: rule.insuranceCents,
            }
          : {}),
        detail: rule.detail || "",
        period: date.slice(0, 7),
        normalizedLabel: true,
        recurrenceId: rule.id,
        occurrenceDate: date,
        payments: [],
        rentCents: rule.rentCents || 0,
        chargesCents: rule.chargesCents || 0,
      };
      t.label = transactionLabel(t, state);
      additions.push(t);
      occurrences.add(key);
      ids.add(id);
      if (state.transactions.length + additions.length > 20000)
        throw new Error(
          "La limite de 20 000 opérations est atteinte. Aucune échéance supplémentaire n’a été enregistrée.",
        );
    }
    const cutoff =
      rule.endDate && rule.endDate < through ? rule.endDate : through;
    updates.push([rule, cutoff]);
  }
  state.transactions.push(...additions);
  for (const [rule, cutoff] of updates) rule.generatedThrough = cutoff;
  return additions.length;
}
export function getForecast(
  state,
  { today = todayISO(), months = 12, propertyId = "all" } = {},
) {
  if (
    !validDate(today) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 60
  )
    throw new Error("Période de prévision invalide.");
  const date = new Date(`${today}T12:00:00Z`);
  const monthStart = `${today.slice(0, 7)}-01`;
  const rows = Array.from({ length: months }, (_, i) => {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + i, 1),
    );
    const period = d.toISOString().slice(0, 7);
    return {
      period,
      label: d.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      income: 0,
      expense: 0,
      balance: 0,
    };
  });
  const last = monthEnd(`${rows.at(-1).period}-01`);
  const scoped = state.transactions.filter(
    (t) => propertyId === "all" || t.propertyId === propertyId,
  );
  const actual = scoped.reduce(
    (n, t) =>
      n +
      getPayments(t)
        .filter((p) => p.date >= state.settings.openingDate && p.date <= today)
        .reduce(
          (m, p) => m + (t.type === "income" ? p.amountCents : -p.amountCents),
          0,
        ),
    0,
  );
  const openingBalance =
    propertyId === "all"
      ? today >= state.settings.openingDate
        ? state.settings.openingBalanceCents + actual
        : null
      : actual;
  let overdueIncome = 0,
    overdueExpense = 0;
  const add = (type, amount, due) => {
    if (due < today) {
      if (type === "income") overdueIncome += amount;
      else overdueExpense += amount;
      return;
    }
    const row = rows.find((m) => m.period === due.slice(0, 7));
    if (row) row[type] += amount;
  };
  for (const t of scoped) {
    const remaining = remainingCents(t);
    if (remaining > 0) add(t.type, remaining, t.dueDate || t.date);
    for (const p of getPayments(t))
      if (p.date > today && p.date <= last) add(t.type, p.amountCents, p.date);
  }
  const existing = new Set(
    state.transactions
      .filter((t) => t.recurrenceId)
      .map((t) => `${t.recurrenceId}:${t.occurrenceDate}`),
  );
  for (const rule of state.recurrences || []) {
    if (
      !rule.active ||
      (propertyId !== "all" && rule.propertyId !== propertyId)
    )
      continue;
    const from =
      rule.generatedThrough && rule.generatedThrough >= today
        ? shiftDay(rule.generatedThrough, 1)
        : today;
    for (const due of leaseRecurrenceDates(state, rule, from, last))
      if (!existing.has(`${rule.id}:${due}`))
        add(rule.type, rule.amountCents, due);
  }
  let balance = openingBalance;
  for (const row of rows) {
    if (balance !== null) balance += row.income - row.expense;
    row.balance = balance;
  }
  return { openingBalance, months: rows, overdueIncome, overdueExpense };
}
