import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "./style.css";
import {
  CATEGORIES,
  categoryFor,
  uid,
  todayISO,
  money,
  moneyInput,
  parseMoney,
  shortDate,
  createDemoState,
  createEmptyState,
  validateTransaction,
  validateProperty,
  validateSettings,
  filterTransactions,
  getSummary,
  serializeBackup,
  parseBackup,
  exportCSV,
  transactionLabel,
  transactionStatus,
  paidCents,
  remainingCents,
  getPayments,
  generateRecurringTransactions,
  monthEnd,
  fold,
} from "./model.js";
import { icon, esc } from "./ui.js";
import { configureEntryForm, entryRequirements } from "./entry-rules.js";
import { assistEntityFields } from "./assisted-select.js";
import { api } from "./api.js";
import { createAttachmentStatus } from "./attachment-status.js";
import { createFinanceUI } from "./finance-ui.js";
import { createDirectoryUI } from "./directory-ui.js";
import { createEntityDocumentsUI } from "./entity-documents-ui.js";
import "./directory.css";
import { createExportUI } from "./export-ui.js";
let exportUI;
let financeUI;
let directoryUI;
let entityDocumentsUI;

const app = document.querySelector("#app");
const dialogRoot = document.querySelector("#dialog-root");
const DEMO_KEY = "atelier.sci.demo.v1";
let state = createDemoState();
let user = null,
  revision = 0,
  dirty = false,
  saving = false,
  serverUnavailable = false,
  syncError = "",
  authExpired = false,
  view = "dashboard",
  year = new Date().getFullYear(),
  propertyId = "all",
  query = "",
  status = "all",
  category = "all",
  documentFilter = "all",
  pageNumber = 1,
  menuId = null,
  lastFocus,
  toastTimer;
let theme = "light";
try {
  theme = localStorage.getItem("atelier.theme") === "dark" ? "dark" : "light";
  const saved = localStorage.getItem(DEMO_KEY);
  if (saved) state = parseBackup(saved);
} catch {
  /* Never load an invalid local demo as an authenticated account. */
}
document.documentElement.dataset.theme = theme;
const attachmentStatus = createAttachmentStatus({ getUser: () => user, getState: () => state, onChange: () => { if (view === "transactions" && documentFilter !== "all" && document.querySelector("#ledger-results")) renderLedger(); } });
const propertyFor = (id) => state.properties.find((p) => p.id === id);
const activeLeaseFor = id => (state.leases || []).find(l => l.propertyId === id && l.startDate <= todayISO() && (!l.endDate || l.endDate >= todayISO()));
const occupantFor = p => {
  const lease = activeLeaseFor(p.id);
  return lease ? state.tenants.find(t => t.id === lease.tenantId)?.name || "Locataire" : (state.leases || []).some(l => l.propertyId === p.id) ? "Aucune location en cours" : p.tenant || "Non renseigné";
};
const navItems = [
  ["dashboard", "grid", "Vue d’ensemble"],
  ["transactions", "receipt", "Opérations"],
  ["recurrences", "calendar", "Opérations périodiques"],
  ["pointing", "check", "Pointage mensuel"],
  ["arrears", "clock", "Loyers impayés"],
  ["forecast", "wallet", "Prévisionnel"],
  ["properties", "building", "Biens immobiliers"],
  ["suppliers", "folder", "Fournisseurs"],
  ["tenants", "lock", "Locataires"],
  ["leases", "building", "Locations"],
  ["bank-checks", "check", "Contrôle bancaire"],
  ["exports", "download", "Export comptable"],
  ["backups", "folder", "Sauvegardes"],
];
const titleFor = () =>
  navItems.find((v) => v[0] === view)?.[2] || "Vue d’ensemble";
const options = (items, value) =>
  items
    .map(
      (item) =>
        `<option value="${esc(item.id)}" ${String(item.id) === String(value) ? "selected" : ""}>${esc(item.label)}</option>`,
    )
    .join("");
const selectableProperties = () => [
  { id: "", label: "SCI / Général" },
  ...state.properties.map((p) => ({
    id: p.id,
    label: p.name + (p.archived ? " (archivé)" : ""),
  })),
];
const fiscalLabel = () =>
  state.settings.taxRegime === "unknown"
    ? "Régime à préciser"
    : `SCI à l’${state.settings.taxRegime}`;

function houseArt(color = "#648bb0") {
  return `<svg viewBox="0 0 250 150" fill="none" aria-hidden="true"><ellipse cx="125" cy="139" rx="103" ry="6" fill="${color}" opacity=".13"/><path d="M33 79 73 45l40 34v57H33Z" fill="#dce7f1"/><path d="m25 80 48-42 48 42" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="58" y="99" width="25" height="37" rx="3" fill="#91acc6"/><path d="M103 41 147 17l44 24v95h-88Z" fill="#fbfdff" stroke="#c6d8e8"/><path d="M96 44 147 15l51 29" stroke="${color}" stroke-width="4" stroke-linecap="round"/><g fill="#cbdced"><rect x="120" y="51" width="16" height="21" rx="3"/><rect x="155" y="51" width="16" height="21" rx="3"/><rect x="120" y="85" width="16" height="21" rx="3"/><rect x="155" y="85" width="16" height="21" rx="3"/></g><rect x="139" y="114" width="17" height="22" rx="3" fill="${color}"/><path d="M210 135v-30m0 13c-20-2-23-17-18-25 15 1 20 14 18 25Zm0-8c19-1 25-15 20-25-16 0-22 13-20 25Z" fill="#a2b9a4"/><path d="m199 127 3 12h15l3-12" fill="#dbccb6"/><path d="m36 30 2-6 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#91acc6"/><circle cx="212" cy="50" r="5" fill="#e6c892"/></svg>`;
}

function shell() {
  app.innerHTML = `<div class="app-layout"><div class="sidebar-overlay" data-action="close-sidebar"></div><aside class="sidebar" aria-label="Navigation principale"><a class="brand" href="/" aria-label="Cap SCI, accueil"><span class="brand-symbol">${icon("building")}</span><span>cap<small>SCI</small></span></a><button class="workspace-label" data-action="settings" aria-label="Paramètres de la SCI"><span class="workspace-avatar">${icon("building")}</span><span class="workspace-name">${esc(state.settings.name)}<small>${esc(fiscalLabel())}</small></span>${icon("down")}</button><div class="nav-section-label">VOTRE ESPACE</div><nav>${navItems.map(([id, ico, label]) => `<button class="nav-item ${view === id ? "active" : ""}" data-view="${id}" ${view === id ? 'aria-current="page"' : ""}>${icon(ico)}<span>${label}</span>${id === "properties" ? `<span class="nav-count">${state.properties.filter((p) => !p.archived).length}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-note"><span class="tiny-dot"></span>Suivi de trésorerie · ${esc(state.settings.taxRegime === "unknown" ? "régime à préciser" : state.settings.taxRegime)}</div><div class="sidebar-bottom"><div class="advisor-card">${icon("sparkle")}<strong>Les bons comptes,<br>l’esprit tranquille.</strong><p>Des opérations bien rangées pour travailler avec votre comptable.</p><button data-action="open-export">Dossier comptable ${icon("arrow")}</button></div><button class="theme-button" data-action="theme">${icon(theme === "dark" ? "sun" : "moon")} Mode ${theme === "dark" ? "clair" : "sombre"}</button><div class="account-footer">${icon(user ? "lock" : "circle")}<span>${user ? esc(user.email) : "Espace de démonstration"}</span>${user ? `<button class="icon-button" data-action="logout" aria-label="Se déconnecter">${icon("logout")}</button>` : ""}</div></div></aside><main class="main"><header class="topbar"><button class="mobile-menu icon-button" data-action="sidebar" aria-label="Ouvrir la navigation">${icon("menu")}</button><div class="breadcrumb">Mon patrimoine ${icon("chevron")}<span>${titleFor()}</span></div><div class="topbar-right"><span class="sync-indicator ${dirty ? "warning" : ""}">${icon(user ? "lock" : "circle")}<span>${saving ? "Enregistrement…" : dirty ? "Non enregistré" : user ? "Enregistré en ligne" : "Mode démonstration"}</span></span><button class="profile-button" data-action="${user ? "settings" : "auth"}" aria-label="${user ? "Paramètres de la SCI" : "Créer mon compte"}">${user ? esc(state.settings.name.charAt(0).toUpperCase()) : icon("plus")}</button></div></header><div class="workspace-content"><div id="notice-area"></div><div class="page-heading"><div><div class="eyebrow">VOTRE PATRIMOINE, EN TOUTE CLARTÉ</div><h1>${titleFor()}<span>.</span></h1><p>${{ recurrences: "Loyers, emprunts, assurances : vos rendez-vous réguliers.", pointing: "Un relevé, quelques cases cochées, des comptes à jour.", arrears: "Retrouvez les loyers et provisions qui restent à recevoir.", forecast: "Anticipez les 12 prochains mois, sans confondre prévu et réglé.", dashboard: "Les bons chiffres pour garder une longueur d’avance.", transactions: "Chaque mouvement, à sa place. Rien de plus, rien de moins.", properties: "Vos adresses, vos locataires, votre patrimoine.", exports: "Un dossier précis, complet et facile à transmettre.", backups: "Vos données vous appartiennent. Gardez-en une copie.", suppliers: "Vos interlocuteurs, leurs coordonnées et leur historique.", tenants: "Les coordonnées et documents de vos locataires.", leases: "Chaque occupation, ses dates et son dossier.", "bank-checks": "Comparez votre suivi avec le solde du relevé bancaire." }[view]}</p></div><button class="button primary" data-action="${({ properties: "add-property", recurrences: "add-recurrence", suppliers: "add-supplier", tenants: "add-tenant", leases: "add-lease", "bank-checks": "add-bank-check" })[view] || "add-transaction"}">${icon("plus")}${({ properties: "Ajouter un bien", recurrences: "Nouvelle périodicité", suppliers: "Ajouter un fournisseur", tenants: "Ajouter un locataire", leases: "Nouvelle location", "bank-checks": "Nouveau contrôle" })[view] || "Nouvelle opération"}</button></div><div id="page-content"></div><footer class="main-footer"><span>Cap SCI · Un patrimoine bien accompagné.</span><span>Suivi de trésorerie · ${esc(fiscalLabel())}</span></footer></div></main></div>`;
  renderNotices();
  renderPage();
}
function renderNotices() {
  const area = document.querySelector("#notice-area");
  area.innerHTML = `${!user ? `<div class="demo-notice">${icon("sparkle")}<span><strong>Un aperçu, pour vous projeter.</strong> Biens, locataires et montants fictifs.</span><button data-action="auth">Créer mon espace ${icon("arrow")}</button></div>` : ""}${serverUnavailable ? '<div class="notice error" role="alert">Le serveur n’est pas joignable. Vous pouvez explorer la démonstration ; la connexion nécessite le serveur Node.js.</div>' : ""}${syncError ? `<div class="notice error" role="alert"><span>${esc(syncError)}</span><div>${authExpired ? '<button data-action="reauth">Se reconnecter</button>' : ""}<button data-action="retry-save">Réessayer</button><button data-action="json">Exporter mes modifications</button><button data-action="reload">Recharger le serveur</button></div></div>` : ""}`;
}
function periodControls() {
  const years = [
    ...new Set([
      new Date().getFullYear(),
      year,
      ...state.transactions.map((t) => Number(t.date.slice(0, 4))),
    ]),
  ].sort((a, b) => b - a);
  return `<div class="period-controls"><div class="period-label">${icon("calendar")}<span>Votre exercice</span></div><select id="year-filter" aria-label="Année">${years.map((y) => `<option ${y === Number(year) ? "selected" : ""}>${y}</option>`).join("")}</select><select id="property-filter" aria-label="Filtrer par bien"><option value="all">Tous les biens</option>${options(
    state.properties.map((p) => ({
      id: p.id,
      label: p.name + (p.archived ? " (archivé)" : ""),
    })),
    propertyId,
  )}</select><button class="button secondary compact" data-action="csv">${icon("download")}Exporter en CSV</button></div>`;
}
function renderPage() {
  const content = document.querySelector("#page-content");
  if (view === "dashboard") renderDashboard(content);
  if (view === "transactions") renderTransactions(content);
  if (view === "properties") renderProperties(content);
  if (view === "backups") renderBackups(content);
  if (view === "exports") exportUI.render(content);
  financeUI.render(view, content);
  directoryUI.render(view, content);
  if (["dashboard", "transactions", "pointing", "arrears"].includes(view)) void attachmentStatus.refresh();
  document.querySelector("#year-filter")?.addEventListener("change", (e) => {
    year = Number(e.target.value);
    pageNumber = 1;
    renderPage();
  });
  document
    .querySelector("#property-filter")
    ?.addEventListener("change", (e) => {
      propertyId = e.target.value;
      pageNumber = 1;
      renderPage();
    });
  document.querySelector("#search")?.addEventListener("input", (e) => {
    query = e.target.value;
    pageNumber = 1;
    renderLedger();
  });
  document.querySelector("#status-filter")?.addEventListener("change", (e) => {
    status = e.target.value;
    pageNumber = 1;
    renderLedger();
  });
  document
    .querySelector("#category-filter")
    ?.addEventListener("change", (e) => {
      category = e.target.value;
      pageNumber = 1;
      renderLedger();
    });
  document.querySelector("#document-filter")?.addEventListener("change", (e) => { documentFilter = e.target.value; pageNumber = 1; renderLedger(); });
  document
    .querySelector("#import-file")
    ?.addEventListener("change", importFile);
}
function renderDashboard(content) {
  const s = getSummary(state, { year, propertyId });
  const stats = [
    [
      "Loyers encaissés",
      s.rent,
      "income",
      "purple",
      "Hors provisions sur charges",
    ],
    [
      "Décaissements réglés",
      s.expense,
      "expense",
      "amber",
      "Tous mouvements sortants réglés",
    ],
    [
      propertyId === "all" ? "Trésorerie" : "Solde des mouvements",
      s.balance,
      "wallet",
      "green",
      propertyId === "all"
        ? `Au ${shortDate(s.asOf)}`
        : "Encaissements − décaissements",
    ],
    [
      "À encaisser",
      s.pendingIncome,
      "clock",
      "blue",
      "Opérations saisies en attente",
    ],
  ];
  content.innerHTML = `${periodControls()}<section class="welcome-banner"><div><span class="welcome-kicker">${esc(state.settings.name)} · ${esc(fiscalLabel())}</span><h2>Chaque bien a son histoire.<br>Vos chiffres ont leur place.</h2><p>Loyers, dépenses et trésorerie : une vue claire pour avancer.</p></div><div class="hero-art">${houseArt()}</div><span class="banner-sticker">Moins de papiers,<br>plus de sérénité.</span></section><section class="stats" aria-label="Indicateurs de trésorerie">${stats.map(([label, value, ico, color, note], i) => `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon(ico)}</span></div><strong class="stat-value" data-testid="metric-${i}">${value === null ? "Non disponible" : money(value)}</strong><span class="stat-caption">${note}</span></div>`).join("")}</section><div class="dashboard-grid"><section class="panel chart-panel"><div class="panel-heading"><div><h2>Vos mouvements au fil des mois</h2><p>Opérations réglées · ${year} · jusqu’au ${shortDate(s.asOf)}</p></div><span class="year-chip">${year}</span></div><div class="chart-legend"><span><i></i>Encaissements</span><span><i></i>Décaissements</span></div>${chart(s.monthly)}</section><section class="panel pending-panel"><div class="panel-heading"><div><h2>À suivre de près</h2><p>Échéances saisies pour ${year}</p></div><span class="pending-count">${s.overdue.length}</span></div><div class="pending-summary"><span>À décaisser</span><strong>${money(s.pendingExpense)}</strong></div><div class="pending-list">${
    filterTransactions(state, { year, propertyId, status: "pending" })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3)
      .map(
        (t) =>
          `<button class="pending-item" data-action="edit-transaction" data-id="${esc(t.id)}"><span class="pending-icon ${t.type}">${icon(t.type)}</span><span><strong>${esc(transactionLabel(t, state))}</strong><small>${esc(propertyFor(t.propertyId)?.name || "SCI / Général")} · ${shortDate(t.date)}</small></span><b class="${t.type}">${money(t.amountCents)}</b></button>`,
      )
      .join("") ||
    `<div class="small-empty">${icon("check")}Aucune échéance en attente.</div>`
  }</div><button class="text-link" data-action="pending">Voir les opérations en attente ${icon("arrow")}</button><p class="micro-note">Ajoutez vos loyers et dépenses régulières dans « Opérations périodiques », puis confirmez leurs règlements dans le pointage mensuel.</p></section></div><section class="panel recent-panel"><div class="panel-heading"><div><h2>Dernières opérations</h2><p>Le détail derrière vos chiffres.</p></div><button class="text-link" data-view="transactions">Tout voir ${icon("arrow")}</button></div>${ledgerHTML(filterTransactions(state, { year, propertyId }).slice(0, 5))}</section><div class="accounting-note">${icon("receipt")}<p><strong>À partager avec votre comptable.</strong> Les montants suivent les flux de trésorerie. Le capital d’emprunt, les dépôts de garantie et les apports sont distingués des loyers. Les amortissements, le résultat fiscal à l’IS, la TVA éventuelle et les déclarations ne sont pas calculés ici.</p></div>`;
}
function chart(monthly) {
  const max = Math.max(...monthly.flatMap((m) => [m.income, m.expense]), 10000);
  const ceiling = Math.ceil(max / 10000) * 10000;
  const y = (value) => 180 - (value / ceiling) * 145;
  const bars = monthly
    .map(
      (m, i) =>
        `<g><rect x="${57 + i * 43}" y="${y(m.income)}" width="11" height="${180 - y(m.income)}" rx="3" fill="#426e99"><title>${esc(m.label)} : encaissements ${money(m.income)}</title></rect><rect x="${71 + i * 43}" y="${y(m.expense)}" width="11" height="${180 - y(m.expense)}" rx="3" fill="#e4bf80"><title>${esc(m.label)} : décaissements ${money(m.expense)}</title></rect><text x="${69 + i * 43}" y="204" text-anchor="middle">${esc(m.label.replace(".", ""))}</text></g>`,
    )
    .join("");
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 590 220" role="img" aria-label="Encaissements et décaissements réglés par mois, en euros">${[0, 0.5, 1].map((r) => `<line x1="48" y1="${180 - r * 145}" x2="580" y2="${180 - r * 145}"/><text x="39" y="${184 - r * 145}" text-anchor="end">${Math.round((ceiling * r) / 100).toLocaleString("fr-FR")}</text>`).join("")}${bars}</svg></div><div class="sr-only"><table><caption>Mouvements mensuels réglés en euros</caption><thead><tr><th>Mois</th><th>Encaissements</th><th>Décaissements</th></tr></thead><tbody>${monthly.map((m) => `<tr><th>${esc(m.label)}</th><td>${money(m.income)}</td><td>${money(m.expense)}</td></tr>`).join("")}</tbody></table></div>`;
}
function ledgerHTML(rows) {
  if (!rows.length)
    return `<div class="empty-state">${icon("receipt")}<h3>Aucune opération pour le moment</h3><p>Ajoutez un premier mouvement ou ajustez vos filtres.</p><button class="button secondary" data-action="add-transaction">${icon("plus")}Ajouter une opération</button></div>`;
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Tableau défilant des opérations"><table class="ledger"><thead><tr><th>Date</th><th>Opération</th><th>Bien</th><th>Montant</th><th>Statut</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((t) => `<tr data-testid="operation-row" data-id="${esc(t.id)}"><td class="date-cell">${shortDate(t.date)}</td><td><div class="operation-cell"><span class="flow-icon ${t.type}">${icon(t.type)}</span><span><button class="operation-label" data-action="edit-transaction" data-id="${esc(t.id)}">${esc(transactionLabel(t, state))}</button><small>${esc(categoryFor(t.category).label)}${t.reference ? ` · ${esc(t.reference)}` : ""}</small>${attachmentStatus.html(t.id)}${t.supplierId ? `<button class="text-link" data-action="view-supplier" data-id="${esc(t.supplierId)}">${esc(state.suppliers.find(s=>s.id===t.supplierId)?.name || "Fournisseur")}</button>` : t.tenantId ? `<button class="text-link" data-action="view-tenant" data-id="${esc(t.tenantId)}">${esc(state.tenants.find(n=>n.id===t.tenantId)?.name || "Locataire")}</button>` : ""}</span></div></td><td><span class="property-cell">${esc(propertyFor(t.propertyId)?.name || "SCI / Général")}</span></td><td class="amount ${t.type}">${t.type === "income" ? "+" : "−"} ${money(t.amountCents)}${paidCents(t) > 0 && remainingCents(t) > 0 ? `<small>Réglé ${money(paidCents(t))} · Reste ${money(remainingCents(t))}</small>` : ""}</td><td><span class="status-pill ${transactionStatus(t)}"><i></i>${{ paid: "Réglée", partial: "Partiellement réglé", overdue: "En retard", pending: "Prévu" }[transactionStatus(t)]}</span></td><td><button class="icon-button" data-action="operation-menu" data-id="${esc(t.id)}" aria-label="Actions pour ${esc(transactionLabel(t, state))}" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`;
}
function renderTransactions(content) {
  content.innerHTML = `${periodControls()}<section class="panel transactions-panel"><div class="panel-heading"><div><h2>Journal des mouvements</h2><p>Encaissements et décaissements, réglés ou prévus.</p></div><span class="year-chip">EUR</span></div><div class="ledger-toolbar"><div class="search-field">${icon("search")}<input id="search" type="search" placeholder="Rechercher une opération…" aria-label="Rechercher une opération" value="${esc(query)}"></div><select id="status-filter" aria-label="Filtrer par statut">${options(
    [
      { id: "all", label: "Tous les statuts" },
      { id: "paid", label: "Réglées" },
      { id: "pending", label: "En attente" },
    ],
    status,
  )}</select><select id="category-filter" aria-label="Filtrer par catégorie">${options([{ id: "all", label: "Toutes les catégories" }, ...CATEGORIES], category)}</select><select id="document-filter" aria-label="Filtrer les justificatifs">${options([{id:"all",label:"Tous les justificatifs"},{id:"missing",label:"Justificatifs manquants"},{id:"attached",label:"Avec justificatif"},{id:"not-required",label:"Justificatif non nécessaire"}],documentFilter)}</select><button class="text-link" data-action="reset-filters">Réinitialiser</button></div><div id="ledger-results"></div></section>`;
  renderLedger();
}
function renderLedger() {
  const rows = filterTransactions(state, {
    year,
    propertyId,
    query,
    status,
    category,
  }).filter(t => documentFilter === "all" || (documentFilter === "not-required" ? t.documentNotRequired : documentFilter === "missing" ? !t.documentNotRequired && attachmentStatus.count(t.id) === 0 : (attachmentStatus.count(t.id) ?? 0) > 0));
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  pageNumber = Math.min(pageNumber, pages);
  document.querySelector("#ledger-results").innerHTML =
    `${ledgerHTML(rows.slice((pageNumber - 1) * 12, pageNumber * 12))}<div class="table-footer"><span>${rows.length} opération${rows.length !== 1 ? "s" : ""} · Les opérations en attente n’affectent pas la trésorerie.</span><div><button class="icon-button" data-action="previous" aria-label="Page précédente" ${pageNumber === 1 ? "disabled" : ""}>${icon("chevron", "rotate")}</button><span>${pageNumber} / ${pages}</span><button class="icon-button" data-action="next" aria-label="Page suivante" ${pageNumber === pages ? "disabled" : ""}>${icon("chevron")}</button></div></div>`;
}
function renderProperties(content) {
  const active = state.properties.filter((p) => !p.archived);
  const rent = active.reduce((n, p) => n + p.rentCents, 0);
  content.innerHTML = `<div class="property-summary"><span>${icon("building")}<b>${active.length}</b> bien${active.length !== 1 ? "s" : ""} actif${active.length !== 1 ? "s" : ""}</span><span>Loyers mensuels de référence <strong>${money(rent)}</strong><small>Hors charges · ne constitue pas un encaissement</small></span></div><div class="properties-grid">${state.properties.map((p, i) => `<article class="property-card ${p.archived ? "archived" : ""}" data-testid="property-card"><div class="property-illustration tone-${i % 3}">${houseArt(["#648bb0", "#8caa94", "#c0a176"][i % 3])}<span>${p.archived ? "Archivé" : "Bien locatif"}</span></div><div class="property-body"><h2>${esc(p.name)}</h2><p class="address">${esc(p.address || "Adresse à renseigner")}</p><div class="tenant">${icon("lock")}<span>Locataire<strong>${esc(occupantFor(p))}</strong></span></div><div class="rent-details"><div><span>Loyer mensuel HC</span><strong>${money(p.rentCents)}</strong></div><div><span>Provisions / mois</span><strong>${money(p.chargesCents)}</strong></div></div><div class="property-actions"><button class="text-link" data-action="view-property" data-id="${esc(p.id)}">${icon("folder")}Dossier du bien</button><button class="text-link" data-action="edit-property" data-id="${esc(p.id)}">${icon("edit")}Modifier</button><button class="text-link muted" data-action="archive-property" data-id="${esc(p.id)}">${p.archived ? "Réactiver" : "Archiver"}</button></div></div></article>`).join("")}<button class="new-property-card" data-action="add-property">${icon("plus")}<strong>Une nouvelle adresse ?</strong><span>Ajouter un bien à votre patrimoine</span></button></div><div class="accounting-note">${icon("folder")}<p>Archiver un bien conserve son historique. Les opérations restent visibles dans le journal et les exports. Utilisez le nom court pour retrouver chaque bien. Configurez les loyers dans « Opérations périodiques » pour préparer les échéances, puis pointez les règlements.</p></div>`;
}
function renderBackups(content) {
  content.innerHTML = `<div class="backup-intro"><span class="backup-illustration">${icon("lock")}</span><h2>Votre SCI vous suit.<br>Vos données restent à vous.</h2><p>${user ? "Vos données sont enregistrées sur le serveur de votre compte. Une sauvegarde JSON permet aussi de conserver une copie indépendante." : "Explorez librement la démonstration. Créez un compte pour enregistrer votre SCI sur le serveur et la retrouver sur plusieurs appareils."}</p></div><div class="backup-grid"><section class="panel backup-card"><span class="feature-icon purple">${icon("download")}</span><h2>Une copie complète</h2><p>Biens, périodicités, opérations, règlements et paramètres réunis en JSON. Les fichiers justificatifs sont exclus : téléchargez-les séparément ou sauvegardez la base serveur.</p><button class="button primary" data-action="json">${icon("download")}Télécharger la sauvegarde</button></section><section class="panel backup-card"><span class="feature-icon green">${icon("upload")}</span><h2>Reprendre une sauvegarde</h2><p>Restaurez un fichier Cap SCI. Un aperçu et une confirmation précèdent le remplacement de vos données.</p><button class="button secondary" data-action="import">${icon("upload")}Importer une sauvegarde</button><input id="import-file" type="file" accept=".json,application/json" hidden></section><section class="panel backup-card"><span class="feature-icon amber">${icon("receipt")}</span><h2>Pour votre comptable</h2><p>Choisissez une plage de dates, les opérations et les justificatifs à transmettre. Le dossier ZIP contient des CSV détaillés et les pièces classées par bien. Ce dossier n’est pas un FEC.</p><button class="button secondary" data-action="open-export">${icon("download")}Préparer un dossier comptable</button></section><section class="panel backup-card"><span class="feature-icon blue">${icon(user ? "building" : "lock")}</span><h2>${user ? "Votre espace personnel" : "Votre SCI, sur tous vos écrans"}</h2><p>${user ? `Connecté en tant que ${esc(user.email)}. Pour accéder à vos données ailleurs, connectez-vous à la même adresse du site avec ce compte.` : "Créez votre espace avec un e-mail et un mot de passe. Le compte démarre sans données de démonstration."}</p><button class="button secondary" data-action="${user ? "settings" : "auth"}">${icon(user ? "settings" : "plus")}${user ? "Paramètres de ma SCI" : "Créer mon compte"}</button></section></div><div class="notice">${icon("folder")}<span>Le fichier JSON contient les informations de votre SCI et de vos locataires. Conservez-le dans un emplacement privé. La synchronisation ne remplace pas une sauvegarde indépendante.</span></div>`;
}

function toast(message, error = false) {
  const el = document.querySelector("#toast");
  el.innerHTML = `${icon(error ? "flag" : "check")}<span>${esc(message)}</span>`;
  el.className = "visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 5200);
}
async function persist(message) {
  if (saving) return;
  dirty = true;
  if (!user) {
    try {
      generateRecurringTransactions(state, monthEnd(todayISO()));
      localStorage.setItem(DEMO_KEY, serializeBackup(state));
      dirty = false;
    } catch {
      syncError =
        "La démonstration ne peut pas être enregistrée dans ce navigateur.";
    }
    shell();
    toast(message);
    return;
  }
  saving = true;
  shell();
  try {
    const result = await api(
      "/state",
      { state, revision, accountId: user.id },
      "PUT",
    );
    revision = result.revision;
    if (result.state) state = parseBackup(result.state);
    dirty = false;
    syncError = "";
    toast(message);
  } catch (error) {
    syncError = error.message;
    authExpired = error.status === 401 || error.code === "account_changed";
    toast("Vos modifications ne sont pas encore enregistrées.", true);
  } finally {
    saving = false;
    shell();
  }
}
function navigate(next) {
  view = next;
  pageNumber = 1;
  closeMenu();
  document.body.classList.remove("sidebar-open");
  shell();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function closeMenu(restore = false) {
  const trigger = menuId
    ? document.querySelector(
        `[data-action="operation-menu"][data-id="${CSS.escape(menuId)}"]`,
      )
    : null;
  document.querySelector("#operation-menu")?.remove();
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  menuId = null;
  if (restore) trigger?.focus();
}
function operationMenu(id, button) {
  const wasOpen = menuId === id;
  closeMenu();
  if (wasOpen) return;
  const t = state.transactions.find((t) => t.id === id);
  if (!t) return;
  const menu = document.createElement("div");
  menu.id = "operation-menu";
  menu.className = "operation-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button role="menuitem" data-action="duplicate-transaction" data-id="${esc(id)}">${icon("plus")}Dupliquer</button><button role="menuitem" data-action="edit-transaction" data-id="${esc(id)}">${icon("edit")}Modifier</button><button role="menuitem" data-action="toggle-paid" data-id="${esc(id)}">${icon(t.status === "paid" ? "clock" : "check")}${remainingCents(t) > 0 ? "Enregistrer un règlement" : "Voir les règlements"}</button><button role="menuitem" data-action="attachments" data-id="${esc(id)}">${icon("folder")}Justificatifs</button><div class="menu-divider"></div><button class="danger-text" role="menuitem" data-action="delete-transaction" data-id="${esc(id)}">${icon("trash")}Supprimer</button>`;
  document.body.append(menu);
  const r = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - 235, innerWidth - 243))}px`;
  const h = menu.offsetHeight;
  menu.style.top = `${r.bottom + h > innerHeight - 8 ? Math.max(8, r.top - h) : r.bottom + 5}px`;
  menuId = id;
  button.setAttribute("aria-expanded", "true");
  menu.querySelector("button").focus();
}
const dialogFocus = new WeakMap();
function closeDialog() {
  const d = [...dialogRoot.querySelectorAll("dialog")].at(-1);
  if (!d) return;
  const focus = dialogFocus.get(d);
  d.close();
  d.remove();
  if (focus?.isConnected) focus.focus();
}
function requestCloseDialog(d) {
  if (d.querySelector("form")?.dataset.changed === "true") {
    const guard = mountDialog(`<dialog class="confirm-dialog" aria-labelledby="discard-title"><h2 id="discard-title">Abandonner les modifications ?</h2><p>La saisie de cette fenêtre n’a pas encore été enregistrée.</p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Continuer la saisie</button><button type="button" class="button danger" id="discard-form">Abandonner</button></div></dialog>`);
    guard.querySelector("#discard-form").addEventListener("click", () => { closeDialog(); closeDialog(); });
  } else closeDialog();
}
function mountDialog(html) {
  const focus = menuId ? document.querySelector(`[data-action="operation-menu"][data-id="${CSS.escape(menuId)}"]`) : document.activeElement;
  closeMenu();
  const template = document.createElement("template");
  template.innerHTML = html;
  const d = template.content.querySelector("dialog");
  const namespace = `dialog-${uid()}`;
  const remapped = new Map();
  d.querySelectorAll("[id]").forEach(el => { if (el.id === "dialog-title" || el.id.startsWith("field-")) { const old = el.id; el.id = `${namespace}-${old}`; remapped.set(old, el.id); } });
  [d, ...d.querySelectorAll("[for],[aria-labelledby],[aria-describedby]")].forEach(el => {
    for (const attr of ["for", "aria-labelledby", "aria-describedby"]) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, el.getAttribute(attr).split(" ").map(id => remapped.get(id) || id).join(" "));
    }
  });
  dialogRoot.append(d);
  dialogFocus.set(d, focus);
  d.showModal();
  assistEntityFields(d);
  configureEntryForm(d);
  d.addEventListener("cancel", e => { e.preventDefault(); requestCloseDialog(d); });
  d.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => requestCloseDialog(d)));
  const changed = e => {
    e.currentTarget.dataset.changed = "true";
    d.querySelector(".validation-summary")?.remove();
    const fields = new Set([e.target.name]);
    if (["supplierId", "tenantId", "leaseId", "propertyId", "category", "type"].includes(e.target.name))
      ["supplierId", "tenantId", "leaseId", "propertyId", "counterparty"].forEach(name => fields.add(name));
    if (["rent", "charges", "capital", "interest", "insurance"].includes(e.target.name)) fields.add("amount");
    d.querySelectorAll("[data-error]").forEach(el => { if (fields.has(el.dataset.error)) el.textContent = ""; });
    d.querySelectorAll("[aria-invalid]").forEach(el => { if (fields.has(el.name)) el.setAttribute("aria-invalid", "false"); });
  };
  d.querySelector("form")?.addEventListener("input", changed);
  d.querySelector("form")?.addEventListener("change", changed);
  return d;
}
const field = (name, label, value = "", type = "text", attrs = "") =>
  `<div class="form-field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}><span class="field-error" data-error="${name}"></span></div>`;
const selectField = (name, label, items, value) =>
  `<div class="form-field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}">${options(items, value)}</select><span class="field-error" data-error="${name}"></span></div>`;
const formHeader = (title, subtitle, ico) =>
  `<div class="dialog-heading"><span class="dialog-mark">${icon(ico)}</span><button type="button" class="icon-button" data-close aria-label="Fermer">${icon("close")}</button></div><h2 id="dialog-title">${esc(title)}</h2><p class="dialog-description">${esc(subtitle)}</p>`;
const formFooter = (label = "Enregistrer") =>
  `<div class="dialog-footer"><button type="button" class="button secondary" data-close>Annuler</button><button type="submit" class="button primary">${icon("check")}${label}</button></div>`;
function showErrors(dialog, errors) {
  dialog.querySelectorAll("[data-error]").forEach((el) => {
    el.textContent = errors[el.dataset.error] || "";
    const input = dialog.querySelector(`[name="${el.dataset.error}"]`);
    if (input) {
      input.setAttribute("aria-invalid", String(!!errors[el.dataset.error]));
      el.id = `error-${el.dataset.error}`;
      input.setAttribute("aria-describedby", el.id);
    }
  });
  let summary = dialog.querySelector(".validation-summary");
  if (summary) summary.remove();
  if (Object.keys(errors).length) {
    summary = document.createElement("p");
    summary.className = "finance-error validation-summary";
    summary.setAttribute("role", "alert");
    summary.textContent = Object.values(errors).join(" ");
    dialog.querySelector(".dialog-footer")?.before(summary);
    dialog.querySelector(`[name="${Object.keys(errors)[0]}"]`)?.focus();
    return true;
  }
  return false;
}
function allowMutation() {
  if (saving) {
    toast("Un enregistrement est déjà en cours.", true);
    return false;
  }
  if (user && dirty) {
    toast(
      "Enregistrez ou exportez vos modifications avant de continuer.",
      true,
    );
    return false;
  }
  return true;
}
function transactionForm(id, duplicateId) {
  if (!allowMutation()) return;
  const existing = state.transactions.find((t) => t.id === id);
  const source = state.transactions.find(t => t.id === duplicateId);
  const t = existing || (source ? { ...structuredClone(source), id: uid(), date: todayISO(), dueDate: "", period: todayISO().slice(0,7), status: "pending", payments: [], reference: "", recurrenceId: "", occurrenceDate: "" } : null) || {
    id: uid(),
    date: todayISO(),
    type: "income",
    status: "pending",
    category: "rent",
    propertyId: propertyId === "all" ? "" : propertyId,
    label: "",
    amountCents: 0,
    rentCents: 0,
    chargesCents: 0,
    counterparty: "",
    reference: "",
    notes: "",
    normalizedLabel: true,
    period: todayISO().slice(0, 7),
    detail: "",
  };
  const d = mountDialog(
    `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier l’opération" : "Nouvelle opération", "Un libellé commun, une période claire, des comptes lisibles.", "receipt")}<div class="form-grid">${selectField(
      "type",
      "Type",
      [
        { id: "income", label: "Encaissement" },
        { id: "expense", label: "Décaissement" },
      ],
      t.type,
    )}${selectField(
      "category",
      "Catégorie",
      CATEGORIES.filter((c) => c.type === t.type),
      t.category,
    )}${selectField("propertyId", "Bien", selectableProperties(), t.propertyId)}${field("period", "Période concernée", t.period || (t.dueDate || t.date).slice(0, 7), "month", "required")}</div><div id="transaction-amounts"></div><label class="check-label"><input type="checkbox" id="standard-label" ${t.normalizedLabel ? "checked" : ""}>Libellé automatique : type · bien · catégorie · période</label>${field("label", "Libellé *", t.label, "text", 'maxlength="400" required')}${field("detail", "Détail (facultatif)", t.detail || "", "text", 'maxlength="160" placeholder="Ex. : Remplacement du chauffe-eau"')}<div class="form-grid">${field("date", "Date / échéance *", t.date, "date", "required")}${selectField(
      "status",
      "Statut",
      [
        { id: "pending", label: "En attente" },
        { id: "paid", label: "Réglée" },
      ],
      t.status,
    )}${field("counterparty", "Fournisseur / bénéficiaire / locataire", t.counterparty, "text", 'maxlength="160" list="known-counterparties"')}${field("reference", "Référence de facture", t.reference, "text", 'maxlength="100"')}</div><div id="operation-parties"></div><datalist id="known-counterparties">${[...new Set(state.transactions.map(row => row.counterparty).filter(Boolean))].map(name => `<option value="${esc(name)}"></option>`).join("")}</datalist><label class="check-label"><input type="checkbox" name="documentNotRequired" ${t.documentNotRequired ? "checked" : ""}>Justificatif non nécessaire</label><div class="form-field"><label for="field-notes">Note pour le comptable</label><textarea name="notes" id="field-notes" rows="2" maxlength="3000">${esc(t.notes)}</textarea><span class="field-error" data-error="notes"></span></div><p class="form-note">« Réglée » confirme un règlement total à la date indiquée. Pour un paiement partiel, enregistrez d’abord l’échéance en attente puis utilisez le pointage. Les règlements existants se gèrent dans « Règlements ».</p>${formFooter(existing ? "Enregistrer" : "Ajouter l’opération")}</form></dialog>`,
  );
  const form = d.querySelector("form");
  let selectedSupplier = t.supplierId || "", selectedLease = t.leaseId || "", selectedTenant = t.tenantId || "";
  function parties() {
    const suppliers = (state.suppliers || []).filter(s => !s.archived || s.id === selectedSupplier);
    const property = form.elements.propertyId.value;
    const tenants = (state.tenants || []).filter(n => !n.archived || n.id === selectedTenant);
    const leases = (state.leases || []).filter(l => !property || l.propertyId === property);
    if (!leases.some(l => l.id === selectedLease)) selectedLease = "";
    d.querySelector("#operation-parties").innerHTML = `<div class="form-grid">${selectField("supplierId", "Fournisseur enregistré", [{id:"",label:"Aucun / saisie libre"},...suppliers.map(s => ({id:s.id,label:s.name}))],selectedSupplier)}${selectField("tenantId", "Locataire enregistré", [{id:"",label:"Aucun / saisie libre"},...tenants.map(n => ({id:n.id,label:n.name}))],selectedTenant)}${selectField("leaseId", "Location / locataire", [{id:"",label:"Aucune / saisie libre"},...leases.map(l => ({id:l.id,label:`${state.tenants.find(n => n.id === l.tenantId)?.name || "Locataire"} · ${propertyFor(l.propertyId)?.name || "Bien"} · ${l.startDate}`}))], selectedLease)}</div><button type="button" class="text-link" id="inline-supplier">Créer un fournisseur</button><button type="button" class="text-link" id="inline-tenant">Créer un locataire</button><button type="button" class="text-link" id="inline-lease">Créer une location</button>`;
    form.elements.supplierId.addEventListener("change", () => {
      selectedSupplier = form.elements.supplierId.value;
      const supplier = suppliers.find(s => s.id === selectedSupplier);
      if (supplier) {
        selectedLease = ""; selectedTenant = ""; form.elements.leaseId.value = ""; form.elements.tenantId.value = "";
        form.elements.counterparty.value = supplier.name;
        const associated = state.properties.filter(p => (p.supplierIds || []).includes(supplier.id));
        if (!existing && !form.elements.propertyId.value && associated.length === 1) form.elements.propertyId.value = associated[0].id;
        if (!existing && supplier.category && categoryFor(supplier.category)?.type === form.elements.type.value) { form.elements.category.value = supplier.category; amounts(); }
      }
    });
    form.elements.tenantId.addEventListener("change", () => {
      selectedTenant = form.elements.tenantId.value;
      const tenant = tenants.find(n => n.id === selectedTenant);
      selectedLease = ""; form.elements.leaseId.value = "";
      if (tenant) {
        selectedSupplier = ""; form.elements.supplierId.value = "";
        form.elements.counterparty.value = tenant.name;
        const available = (state.leases || []).filter(l => l.tenantId === tenant.id && (!property || l.propertyId === property) && l.startDate <= form.elements.date.value && (!l.endDate || l.endDate >= form.elements.date.value));
        if (available.length === 1) { form.elements.leaseId.value = available[0].id; form.elements.leaseId.dispatchEvent(new Event("change",{bubbles:true})); }
      }
    });
    form.elements.leaseId.addEventListener("change", () => {
      selectedLease = form.elements.leaseId.value;
      const lease = state.leases.find(l => l.id === selectedLease);
      if (lease) {
        selectedSupplier = ""; form.elements.supplierId.value = "";
        selectedTenant = lease.tenantId; form.elements.tenantId.value = lease.tenantId;
        form.elements.propertyId.value = lease.propertyId;
        form.elements.counterparty.value = state.tenants.find(n => n.id === lease.tenantId)?.name || "";
        if (!existing && form.elements.rent) { form.elements.rent.value = moneyInput(lease.rentCents); form.elements.charges.value = moneyInput(lease.chargesCents); }
        preview();
      }
    });
    d.querySelector("#inline-lease").addEventListener("click", () => directoryUI.leaseForm(undefined,selectedTenant,form.elements.propertyId.value,lease=>{
      selectedTenant=lease.tenantId; selectedLease=lease.id; selectedSupplier=""; parties(); form.elements.leaseId.dispatchEvent(new Event("change",{bubbles:true}));
    }));
    d.querySelector("#inline-tenant").addEventListener("click", () => directoryUI.tenantForm(undefined, tenant => {
      selectedTenant=tenant.id; selectedLease=""; selectedSupplier=""; parties(); form.elements.tenantId.dispatchEvent(new Event("change",{bubbles:true}));
    }));
    d.querySelector("#inline-supplier").addEventListener("click", () => directoryUI.supplierForm(undefined, supplier => {
      selectedSupplier = supplier.id; parties(); form.elements.supplierId.dispatchEvent(new Event("change", {bubbles:true}));
    }));
  }
  parties();
  let acceptedDuplicate = "";
  function preview() {
    const total = d.querySelector("#loan-total");
    if (total) {
      const parts = ["capital", "interest", "insurance"].map(name =>
        parseMoney(d.querySelector(`[name=${name}]`).value || "0"));
      total.textContent = parts.some(n => n === null) ? "Vérifiez les montants" : money(parts.reduce((a,b) => a + b, 0));
    }
    const v = Object.fromEntries(new FormData(form));
    const normalized = d.querySelector("#standard-label").checked;
    d.querySelector("[name=label]").readOnly = normalized;
    if (normalized)
      d.querySelector("[name=label]").value = transactionLabel(
        { ...t, ...v, normalizedLabel: true },
        state,
      );
  }
  function amounts() {
    const oldAmount = d.querySelector("[name=amount]")?.value;
    const oldRent = d.querySelector("[name=rent]")?.value;
    const oldCharges = d.querySelector("[name=charges]")?.value;
    const loan = d.querySelector("[name=category]").value === "loan_payment";
    const oldLoan = Object.fromEntries(["capital", "interest", "insurance"].map(name => [name, d.querySelector(`[name=${name}]`)?.value]));
    const oldLoanTotal = Object.values(oldLoan).every(v => v !== undefined && parseMoney(v || "0") !== null)
      ? moneyInput(Object.values(oldLoan).reduce((n,v) => n + parseMoney(v || "0"), 0)) : undefined;
    const rental = d.querySelector("[name=category]").value === "rent";
    const amount =
      oldAmount ?? oldLoanTotal ??
      (oldRent !== undefined &&
      parseMoney(oldRent) !== null &&
      parseMoney(oldCharges || "0") !== null
        ? moneyInput(parseMoney(oldRent) + parseMoney(oldCharges || "0"))
        : t.amountCents
          ? moneyInput(t.amountCents)
          : "");
    const rent =
      oldRent ??
      oldAmount ??
      (t.rentCents !== undefined
        ? moneyInput(t.rentCents)
        : t.category === "rent"
          ? moneyInput(t.amountCents)
          : "");
    const charges =
      oldCharges ??
      (oldAmount !== undefined ? "0,00" : moneyInput(t.chargesCents || 0));
    d.querySelector("#transaction-amounts").innerHTML = rental
      ? `<div class="form-grid">${field("rent", "Loyer hors charges (€) *", rent, "text", 'inputmode="decimal" required')}${field("charges", "Provisions sur charges (€)", charges, "text", 'inputmode="decimal"')}</div>`
      : loan
        ? `<div class="form-grid">${field("capital", "Capital remboursé (€) *", oldLoan.capital ?? moneyInput(t.category === "loan_payment" ? t.capitalCents || 0 : 0), "text", 'inputmode="decimal" required')}${field("interest", "Intérêts (€)", oldLoan.interest ?? moneyInput(t.category === "loan_payment" ? t.interestCents || 0 : 0), "text", 'inputmode="decimal"')}${field("insurance", "Assurance emprunteur (€)", oldLoan.insurance ?? moneyInput(t.category === "loan_payment" ? t.insuranceCents || 0 : 0), "text", 'inputmode="decimal"')}</div><p class="payment-summary"><strong>Total de l’échéance : <output id="loan-total" aria-live="polite"></output></strong></p><span class="field-error" data-error="amount"></span><p class="form-note">Reprenez les montants du tableau d’amortissement bancaire. La répartition pourra être ajustée dans le pointage mensuel.</p>`
        : field(
          "amount",
          "Montant (€) *",
          amount,
          "text",
          'inputmode="decimal" required',
        );
    preview();
  }
  d.querySelector("[name=type]").addEventListener("change", (e) => {
    d.querySelector("[name=category]").innerHTML = options(
      CATEGORIES.filter((c) => c.type === e.target.value),
      "",
    );
    amounts();
  });
  d.querySelector("[name=category]").addEventListener("change", amounts);
  d.querySelector("[name=propertyId]").addEventListener("change", (e) => {
    const p = propertyFor(e.target.value);
    if (p && d.querySelector("[name=rent]")) {
      d.querySelector("[name=rent]").value = moneyInput(p.rentCents);
      d.querySelector("[name=charges]").value = moneyInput(p.chargesCents);
      if (!d.querySelector("[name=counterparty]").value)
        d.querySelector("[name=counterparty]").value = p.tenant;
    }
    parties();
    if (p && form.elements.type.value === "income" && form.elements.category.value === "rent" && !selectedSupplier) {
      const available = (state.leases || []).filter(l => l.propertyId === p.id && l.startDate <= form.elements.date.value && (!l.endDate || l.endDate >= form.elements.date.value));
      if (available.length === 1) { form.elements.leaseId.value = available[0].id; form.elements.leaseId.dispatchEvent(new Event("change", {bubbles:true})); }
    }
    preview();
  });
  form.addEventListener("input", preview);
  form.addEventListener("change", preview);
  form.addEventListener("change", () => {
    selectedSupplier=form.elements.supplierId.value;
    selectedTenant=form.elements.tenantId.value;
    selectedLease=form.elements.leaseId.value;
  });
  amounts();
  if (existing && getPayments(t).length) {
    d.querySelector("[name=status]").disabled = true;
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const result = validateTransaction(
      {
        ...t,
        ...values,
        id: t.id,
        normalizedLabel: d.querySelector("#standard-label").checked,
        documentNotRequired: form.elements.documentNotRequired.checked,
        tenantId: state.leases?.find(l => l.id === values.leaseId)?.tenantId || values.tenantId || "",
        rentCents: values.category === "rent" ? t.rentCents : 0,
        chargesCents: values.category === "rent" ? t.chargesCents : 0,
        capitalCents: values.category === "loan_payment" ? t.capitalCents : 0,
        interestCents: values.category === "loan_payment" ? t.interestCents : 0,
        insuranceCents: values.category === "loan_payment" ? t.insuranceCents : 0,
        dueDate: t.dueDate || "",
        status: existing && getPayments(t).length ? t.status : values.status,
      },
      state,
    );
    Object.assign(result.errors, entryRequirements(result.value));
    if (showErrors(d, result.errors)) return;
    const v = result.value;
    const duplicates = state.transactions.filter(row => row.id !== v.id && ((v.reference && fold(row.reference) === fold(v.reference) && fold(row.counterparty) === fold(v.counterparty)) || (row.date === v.date && row.amountCents === v.amountCents && row.propertyId === v.propertyId && row.type === v.type && row.category === v.category)));
    const fingerprint = JSON.stringify(v);
    if (duplicates.length && acceptedDuplicate !== fingerprint) {
      acceptedDuplicate = fingerprint;
      showErrors(d, { duplicate: "Une opération semblable existe déjà. Vérifiez la date, le montant et la référence. Cliquez de nouveau sur Enregistrer / Ajouter pour confirmer cette saisie." });
      return;
    }
    if (existing)
      state.transactions = state.transactions.map((row) =>
        row.id === id ? result.value : row,
      );
    else state.transactions.push(result.value);
    closeDialog();
    persist(
      existing
        ? "L’opération a été mise à jour."
        : "L’opération a été ajoutée.",
    );
  });
}

function viewProperty(id) {
  const p = propertyFor(id);
  if (!p) return;
  const leases = (state.leases || []).filter(l => l.propertyId === id).sort((a,b) => b.startDate.localeCompare(a.startDate));
  const supplierIds = new Set([...(p.supplierIds || []), ...state.transactions.filter(t => t.propertyId === id && t.supplierId).map(t => t.supplierId), ...(state.recurrences || []).filter(r => r.propertyId === id && r.supplierId).map(r => r.supplierId)]);
  const d = mountDialog(`<dialog class="form-dialog directory-dialog" aria-labelledby="dialog-title">${formHeader(p.name,p.address || "Dossier du bien", "building")}<h3>Locataires et locations</h3><ul class="payment-list">${leases.map(l => `<li><span>${esc(state.tenants.find(n => n.id === l.tenantId)?.name || "Locataire")}<small>${shortDate(l.startDate)} → ${l.endDate ? shortDate(l.endDate) : "Sans date de fin"}</small></span><button type="button" class="text-link" data-linked-lease="${esc(l.id)}">Ouvrir la location</button></li>`).join("") || '<li>Aucune location rattachée.</li>'}</ul><button type="button" class="text-link" id="dossier-new-lease">Rattacher un locataire via une location</button><h3>Fournisseurs associés</h3><ul class="payment-list">${[...supplierIds].map(sid => {const supplier=state.suppliers.find(s => s.id === sid); return supplier ? `<li><span>${esc(supplier.name)}</span><button type="button" class="text-link" data-linked-supplier="${esc(sid)}">Ouvrir la fiche</button></li>` : "";}).join("") || '<li>Aucun fournisseur rattaché.</li>'}</ul><p class="form-note">Les fournisseurs proviennent des rattachements de la fiche et des opérations de ce bien.</p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Fermer</button><button type="button" class="button primary" id="dossier-operations">Voir les opérations du bien</button></div></dialog>`);
  d.querySelectorAll("[data-linked-lease]").forEach(b => b.addEventListener("click", () => { closeDialog(); directoryUI.action("view-lease",b.dataset.linkedLease); }));
  d.querySelectorAll("[data-linked-supplier]").forEach(b => b.addEventListener("click", () => { closeDialog(); directoryUI.action("view-supplier",b.dataset.linkedSupplier); }));
  d.querySelector("#dossier-new-lease").addEventListener("click", () => { closeDialog(); directoryUI.leaseForm(undefined,"",id); });
  d.querySelector("#dossier-operations").addEventListener("click", () => { closeDialog(); propertyId=id; navigate("transactions"); });
}
function propertyForm(id) {
  if (!allowMutation()) return;
  const existing = propertyFor(id);
  const p = existing || {
    id: uid(),
    name: "",
    address: "",
    tenant: "",
    rentCents: 0,
    chargesCents: 0,
    archived: false,
  };
  const d = mountDialog(
    `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier le bien" : "Ajouter un bien", "Une nouvelle adresse dans votre espace.", "building")}${field("name", "Nom court du bien *", p.name, "text", 'maxlength="100" required autofocus placeholder="Ex. : Appartement du centre"')}${field("address", "Adresse", p.address, "text", 'maxlength="250"')}${p.tenant && !(state.leases || []).some(l=>l.propertyId===p.id) ? field("tenant", "Ancien locataire (nom historique)", p.tenant, "text", 'maxlength="160" readonly') : ""}<div class="form-grid">${field("rent", "Loyer mensuel hors charges (€)", moneyInput(p.rentCents), "text", 'inputmode="decimal"')}${field("charges", "Provisions mensuelles (€)", moneyInput(p.chargesCents), "text", 'inputmode="decimal"')}</div><p class="form-note">Ces montants sont des références. Pour conserver les changements de locataire, créez les fiches dans « Locataires » puis les occupations dans « Locations ». Le loyer périodique se prépare depuis la location.</p><fieldset class="property-suppliers"><legend>Fournisseurs rattachés au bien</legend><input type="search" id="supplier-assignment-search" aria-label="Rechercher un fournisseur à rattacher" placeholder="Rechercher un fournisseur…">${(state.suppliers || []).filter(s => !s.archived || (p.supplierIds || []).includes(s.id)).map(s => `<label class="check-label" data-supplier-choice="${esc(fold(s.name))}"><input type="checkbox" name="supplierIds" value="${esc(s.id)}" ${(p.supplierIds || []).includes(s.id) ? "checked" : ""}>${esc(s.name)}</label>`).join("") || '<p class="form-note">Créez vos fiches dans Fournisseurs pour les rattacher ici.</p>'}</fieldset>${existing ? `<button type="button" class="text-link" id="property-lease">Rattacher un locataire via une location</button>` : ""}${formFooter(existing ? "Enregistrer" : "Ajouter le bien")}</form></dialog>`,
  );
  d.querySelector("#supplier-assignment-search").addEventListener("input", e => d.querySelectorAll("[data-supplier-choice]").forEach(label => label.hidden = !label.dataset.supplierChoice.includes(fold(e.target.value))));
  d.querySelector("#property-lease")?.addEventListener("click", () => directoryUI.leaseForm(undefined, "", p.id));
  d.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const result = validateProperty({
      ...p,
      ...Object.fromEntries(new FormData(e.currentTarget)),
      id: p.id,
      archived: p.archived,
      supplierIds: new FormData(e.currentTarget).getAll("supplierIds"),
    }, state);
    if (
      state.properties.some(
        (other) =>
          other.id !== p.id && fold(other.name) === fold(result.value.name),
      )
    )
      result.errors.name =
        "Ce nom court est déjà utilisé. Choisissez un nom unique.";
    if (!result.value.address) result.errors.address="Renseignez l’adresse du bien.";
    if (showErrors(d, result.errors)) return;
    if (existing)
      state.properties = state.properties.map((row) =>
        row.id === id ? result.value : row,
      );
    else state.properties.push(result.value);
    closeDialog();
    persist("La fiche du bien a été enregistrée.");
  });
}
function settingsForm() {
  if (!allowMutation()) return;
  const s = state.settings;
  const d = mountDialog(
    `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Paramètres de la SCI", "Le point de départ de vos chiffres.", "settings")}${field("name", "Nom de la SCI *", s.name, "text", 'maxlength="100" required')}${selectField(
      "taxRegime",
      "Régime fiscal",
      [
        { id: "IS", label: "Impôt sur les sociétés (IS)" },
        { id: "IR", label: "Impôt sur le revenu (IR)" },
        { id: "unknown", label: "À préciser" },
      ],
      s.taxRegime,
    )}<div class="form-grid">${field("openingDate", "Date du solde initial *", s.openingDate, "date", "required")}${field("openingBalance", "Solde initial (€) *", moneyInput(s.openingBalanceCents), "text", 'inputmode="decimal" required')}</div><p class="form-note">Le solde initial correspond à votre trésorerie au début de cette date, avant ses mouvements. Il peut être négatif. Les mouvements réglés à partir de cette date s’y ajoutent ou s’en déduisent.</p><p class="form-note">Ce suivi de trésorerie ne produit pas les amortissements, le bilan, le résultat fiscal, le FEC ou les déclarations de votre SCI.</p>${formFooter()}</form></dialog>`,
  );
  d.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const result = validateSettings(
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    if (showErrors(d, result.errors)) return;
    state.settings = result.value;
    closeDialog();
    persist("Les paramètres ont été enregistrés.");
  });
}
function confirmDialog(title, text, label, onConfirm) {
  const d = mountDialog(
    `<dialog class="confirm-dialog" aria-labelledby="dialog-title">${formHeader(title, text, "flag")}<div class="dialog-footer"><button class="button secondary" data-close>Annuler</button><button class="button danger" id="confirm-action">${label}</button></div></dialog>`,
  );
  d.querySelector("#confirm-action").addEventListener("click", () => {
    closeDialog();
    onConfirm();
  });
}
function authDialog(mode = "register") {
  if (user && dirty) mode = "login";
  const d = mountDialog(
    `<dialog class="auth-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(mode === "register" ? "Bienvenue chez vous." : "Content de vous retrouver.", "Votre SCI, accessible avec le même compte sur vos appareils.", "lock")}<div class="auth-tabs"><button type="button" data-auth="register" class="${mode === "register" ? "active" : ""}">Créer mon espace</button><button type="button" data-auth="login" class="${mode === "login" ? "active" : ""}">Se connecter</button></div>${mode === "register" ? field("name", "Nom de votre SCI", "Ma SCI", "text", 'maxlength="100" required') : ""}${field("email", "Adresse e-mail", "", "email", 'autocomplete="email" required')}${field("password", "Mot de passe", "", "password", `minlength="12" maxlength="128" autocomplete="${mode === "register" ? "new-password" : "current-password"}" required`)}<p class="form-note">${mode === "register" ? "Choisissez au moins 12 caractères. Votre compte commence avec une SCI à l’IS, sans les exemples de la démonstration." : "Utilisez les identifiants de votre compte Cap SCI sur ce même serveur."}</p><p class="auth-error" role="alert"></p><button class="button primary auth-submit" type="submit">${icon("lock")}${mode === "register" ? "Créer mon compte" : "Se connecter"}</button></form></dialog>`,
  );
  d.querySelectorAll("[data-auth]").forEach((b) =>
    b.addEventListener("click", () => { closeDialog(); authDialog(b.dataset.auth); }),
  );
  if (user && dirty) {
    d.querySelector('[data-auth="register"]').disabled = true;
    d.querySelector('[name="email"]').value = user.email;
  }
  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const submit = d.querySelector('[type="submit"]');
    submit.disabled = true;
    d.querySelector(".auth-error").textContent = "";
    try {
      if (user && dirty && values.email.trim().toLowerCase() !== user.email)
        throw new Error(
          "Reconnectez-vous au même compte pour conserver vos modifications.",
        );
      const result = await api(
        mode === "register" ? "/register" : "/login",
        values,
      );
      if (user && dirty) {
        if (result.user.id !== user.id)
          throw new Error(
            "Le compte d’origine est introuvable. Exportez vos modifications avant de recharger les données.",
          );
        authExpired = false;
        closeDialog();
        await persist("Vos modifications ont été enregistrées.");
        return;
      }
      acceptSession(result);
      closeDialog();
      shell();
      toast(
        mode === "register"
          ? "Votre espace est créé. Ajoutez votre premier bien."
          : "Vous êtes connecté.",
      );
    } catch (error) {
      d.querySelector(".auth-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}
function acceptSession(result) {
  if (user?.id !== result.user?.id) attachmentStatus.reset();
  state = parseBackup(result.state);
  user = result.user;
  revision = result.revision;
  dirty = false;
  syncError = "";
  authExpired = false;
  serverUnavailable = false;
  propertyId = "all";
  year = new Date().getFullYear();
  query = "";
  status = "all";
  category = "all";
}
function download(contents, name, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvDownload() {
  const rows = filterTransactions(state, {
    year,
    propertyId,
    ...(view === "transactions" ? { query, status, category } : {}),
  });
  download(
    exportCSV(state, rows, { year }),
    `cap-sci-operations-${year}.csv`,
    "text/csv;charset=utf-8",
  );
  toast(`Export CSV de ${year} téléchargé.`);
}
async function importFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file || !allowMutation()) return;
  try {
    if (file.size > 8 * 1024 * 1024)
      throw new Error("Le fichier dépasse 8 Mo.");
    const next = parseBackup(await file.text());
    confirmDialog(
      "Restaurer cette sauvegarde ?",
      `${next.settings.name} · ${next.properties.length} biens · ${next.transactions.length} opérations. Cette action remplacera les données actuelles de cet espace. Exportez-les d’abord si vous souhaitez les conserver.`,
      "Remplacer mes données",
      () => {
        state = next;
        if (user) state.mode = "real";
        propertyId = "all";
        persist("La sauvegarde a été restaurée.");
      },
    );
  } catch (error) {
    toast(error.message, true);
  }
}
async function reloadFromServer() {
  try {
    const result = await api("/session");
    acceptSession(result);
    shell();
    toast("Les données du serveur ont été rechargées.");
  } catch (error) {
    toast(error.message, true);
  }
}

document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action],[data-view]");
  if (
    !e.target.closest("#operation-menu") &&
    !e.target.closest('[data-action="operation-menu"]')
  )
    closeMenu();
  if (!button || button.closest("dialog")) return;
  if (button.dataset.view) {
    navigate(button.dataset.view);
    return;
  }
  const { action, id } = button.dataset;
  if (action === "open-export") {
    navigate("exports");
    return;
  }
  if (directoryUI.action(action, id)) return;
  if (financeUI.action(action, id)) return;
  if (action === "view-property") { viewProperty(id); return; }
  if (action === "view-supplier") { directoryUI.action("view-supplier",id); return; }
  if (action === "view-tenant") { directoryUI.action("view-tenant",id); return; }
  if (action === "duplicate-transaction") { transactionForm(undefined, id); return; }
  if (action === "add-transaction" || action === "edit-transaction")
    transactionForm(id);
  else if (action === "add-property" || action === "edit-property")
    propertyForm(id);
  else if (action === "settings") settingsForm();
  else if (action === "auth") authDialog();
  else if (action === "reauth") authDialog("login");
  else if (action === "operation-menu") operationMenu(id, button);
  else if (action === "delete-transaction" && allowMutation()) {
    const t = state.transactions.find((t) => t.id === id);
    if (t)
      confirmDialog(
        "Supprimer cette opération ?",
        `« ${t.label} » sera supprimée du suivi. Cette action est définitive.`,
        "Supprimer l’opération",
        () => {
          state.transactions = state.transactions.filter((t) => t.id !== id);
          persist("L’opération a été supprimée.");
        },
      );
  } else if (action === "toggle-paid" && allowMutation()) {
    const t = state.transactions.find((t) => t.id === id);
    if (t)
      financeUI.action(
        remainingCents(t) > 0 ? "partial-payment" : "payments-history",
        id,
      );
  } else if (action === "archive-property" && allowMutation()) {
    const p = propertyFor(id);
    if (p)
      confirmDialog(
        p.archived ? "Réactiver ce bien ?" : "Archiver ce bien ?",
        `L’historique de « ${p.name} » et ses opérations sont conservés. ${p.archived ? "Les périodicités restent en pause jusqu’à leur reprise manuelle." : "Les périodicités liées seront mises en pause ; les échéances déjà créées seront conservées."}`,
        p.archived ? "Réactiver le bien" : "Archiver le bien",
        () => {
          p.archived = !p.archived;
          if (p.archived)
            for (const r of state.recurrences || [])
              if (r.propertyId === id) r.active = false;
          persist("La fiche du bien a été mise à jour.");
        },
      );
  } else if (action === "pending") {
    status = "pending";
    navigate("transactions");
  } else if (action === "csv") csvDownload();
  else if (action === "json")
    download(
      serializeBackup(state),
      `cap-sci-sauvegarde-${todayISO()}.json`,
      "application/json",
    );
  else if (action === "import") document.querySelector("#import-file")?.click();
  else if (action === "reset-filters") {
    query = "";
    category = "all";
    documentFilter = "all";
    status = "all";
    propertyId = "all";
    pageNumber = 1;
    renderPage();
  } else if (action === "next") {
    pageNumber++;
    renderLedger();
  } else if (action === "previous") {
    pageNumber = Math.max(1, pageNumber - 1);
    renderLedger();
  } else if (action === "theme") {
    theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("atelier.theme", theme);
    } catch {}
    shell();
  } else if (action === "sidebar") document.body.classList.add("sidebar-open");
  else if (action === "close-sidebar")
    document.body.classList.remove("sidebar-open");
  else if (action === "retry-save")
    persist("Les modifications ont été enregistrées.");
  else if (action === "reload")
    confirmDialog(
      "Recharger les données ?",
      "Les modifications non enregistrées de cet onglet seront remplacées par la version du serveur. Exportez-les d’abord si nécessaire.",
      "Recharger",
      reloadFromServer,
    );
  else if (action === "logout") {
    if (dirty) {
      toast(
        "Exportez ou enregistrez vos modifications avant de vous déconnecter.",
        true,
      );
      return;
    }
    try {
      await api("/logout", {});
      attachmentStatus.reset();
      user = null;
      revision = 0;
      state = createDemoState();
      view = "dashboard";
      propertyId = "all";
      shell();
      toast("Vous êtes déconnecté.");
    } catch (error) {
      toast(error.message, true);
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMenu(true);
    document.body.classList.remove("sidebar-open");
  }
  if (
    e.target.closest("#operation-menu") &&
    ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    const buttons = [...document.querySelectorAll("#operation-menu button")];
    const i = buttons.indexOf(document.activeElement);
    buttons[
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
    ].focus();
  }
});
window.addEventListener("resize", () => closeMenu());
window.addEventListener("beforeunload", (e) => {
  if (user && dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("focus", async () => {
  if (!user || dirty || saving || dialogRoot.querySelector("dialog[open]"))
    return;
  try {
    const result = await api("/session");
    if (result.revision !== revision) {
      acceptSession(result);
      shell();
      toast("Les changements de votre autre appareil sont chargés.");
    }
  } catch {
    /* The next write will expose connectivity/session errors. */
  }
});
financeUI = createFinanceUI({
  getState: () => state,
  setState: (next) => {
    state = next;
  },
  getUser: () => user,
  attachmentStatus,
  createSupplier: callback => directoryUI.supplierForm(undefined, callback),
  createTenant: callback => directoryUI.tenantForm(undefined, callback),
  createLease: (seed,callback) => directoryUI.leaseForm(undefined,seed.tenantId || "",seed.propertyId || "",callback),
  persist,
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
});
exportUI = createExportUI({
  getState: () => state,
  getUser: () => user,
  getYear: () => year,
  isSynced: () => !dirty && !saving,
  field,
  selectField,
  download,
  toast,
});
const sharedDirectoryContext = {
  getState: () => state, setState: next => { state = next; }, getUser: () => user,
  persist, mountDialog, closeDialog, formHeader, formFooter, field, selectField, showErrors, options, allowMutation, toast, confirmDialog,
  openEntityDocuments: (kind, id) => entityDocumentsUI.open(kind, id),
  createRecurrenceForLease: id => financeUI.createFromLease(id),
  editTransaction: id => transactionForm(id),
  viewProperty,
};
entityDocumentsUI = createEntityDocumentsUI(sharedDirectoryContext);
directoryUI = createDirectoryUI(sharedDirectoryContext);
app.innerHTML = '<div class="loading-state">Chargement de votre espace…</div>';
try {
  acceptSession(await api("/session"));
} catch (error) {
  if (error.status !== 401) serverUnavailable = true;
}
shell();
