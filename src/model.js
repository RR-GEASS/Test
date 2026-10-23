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
      name: "Appartement République",
      address: "12 avenue de la République · Lyon",
      tenant: "Camille Martin",
      rentCents: 89000,
      chargesCents: 7500,
      archived: false,
    },
    {
      id: "demo-2",
      name: "Studio des Tilleuls",
      address: "8 rue des Tilleuls · Lyon",
      tenant: "Alex Dubois",
      rentCents: 59000,
      chargesCents: 4500,
      archived: false,
    },
    {
      id: "demo-3",
      name: "Local Bellecour",
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
  return state;
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
  if (!value.label || value.label.length > 160)
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
  return { value, errors };
}
export function validateProperty(input) {
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
        (year === "all" || t.date.slice(0, 4) === String(year)) &&
        (propertyId === "all" || t.propertyId === propertyId) &&
        (status === "all" || t.status === status) &&
        (category === "all" || t.category === category) &&
        (!needle ||
          fold(
            `${t.label} ${t.counterparty} ${t.reference} ${t.notes} ${state.properties.find((p) => p.id === t.propertyId)?.name || ""} ${categoryFor(t.category)?.label || ""}`,
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
  const paid = period.filter((t) => t.status === "paid" && t.date <= asOf);
  const income = paid
    .filter((t) => t.type === "income")
    .reduce((n, t) => n + t.amountCents, 0);
  const expense = paid
    .filter((t) => t.type === "expense")
    .reduce((n, t) => n + t.amountCents, 0);
  const rent = paid
    .filter((t) => t.category === "rent")
    .reduce((n, t) => n + t.amountCents, 0);
  const pending = period.filter((t) => t.status === "pending");
  const pendingIncome = pending
    .filter((t) => t.type === "income")
    .reduce((n, t) => n + t.amountCents, 0);
  const pendingExpense = pending
    .filter((t) => t.type === "expense")
    .reduce((n, t) => n + t.amountCents, 0);
  const overdue = pending.filter((t) => t.date < today);
  const balanceFlows = state.transactions
    .filter(
      (t) =>
        t.status === "paid" &&
        t.date >= state.settings.openingDate &&
        t.date <= asOf,
    )
    .reduce(
      (n, t) => n + (t.type === "income" ? t.amountCents : -t.amountCents),
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
  paid.forEach((t) => {
    monthly[Number(t.date.slice(5, 7)) - 1][t.type] += t.amountCents;
  });
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
    fail("Le format de cette sauvegarde Atelier SCI n’est pas reconnu.");
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
  return state;
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportCSV(state, transactions) {
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
    ],
  ];
  for (const t of transactions)
    rows.push([
      t.date,
      t.dueDate || "",
      t.label,
      state.properties.find((p) => p.id === t.propertyId)?.name ||
        "SCI / Général",
      categoryFor(t.category).label,
      t.type === "income" ? "Encaissement" : "Décaissement",
      t.status === "paid" ? "Réglée" : "En attente",
      t.type === "income" ? moneyInput(t.amountCents) : "",
      t.type === "expense" ? moneyInput(t.amountCents) : "",
      t.counterparty,
      t.reference,
      t.notes,
    ]);
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
