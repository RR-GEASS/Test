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
} from "./model.js";
import { icon, esc } from "./ui.js";
import { api } from "./api.js";

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
const propertyFor = (id) => state.properties.find((p) => p.id === id);
const navItems = [
  ["dashboard", "grid", "Vue d’ensemble"],
  ["transactions", "receipt", "Opérations"],
  ["properties", "building", "Biens immobiliers"],
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

function houseArt(color = "#9a88ca") {
  return `<svg viewBox="0 0 250 150" fill="none" aria-hidden="true"><ellipse cx="125" cy="139" rx="103" ry="6" fill="${color}" opacity=".13"/><path d="M33 79 73 45l40 34v57H33Z" fill="#e6def2"/><path d="m25 80 48-42 48 42" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="58" y="99" width="25" height="37" rx="3" fill="#b5a4d5"/><path d="M103 41 147 17l44 24v95h-88Z" fill="#fdfbff" stroke="#d3c7e5"/><path d="M96 44 147 15l51 29" stroke="${color}" stroke-width="4" stroke-linecap="round"/><g fill="#d9cee9"><rect x="120" y="51" width="16" height="21" rx="3"/><rect x="155" y="51" width="16" height="21" rx="3"/><rect x="120" y="85" width="16" height="21" rx="3"/><rect x="155" y="85" width="16" height="21" rx="3"/></g><rect x="139" y="114" width="17" height="22" rx="3" fill="${color}"/><path d="M210 135v-30m0 13c-20-2-23-17-18-25 15 1 20 14 18 25Zm0-8c19-1 25-15 20-25-16 0-22 13-20 25Z" fill="#a2b9a4"/><path d="m199 127 3 12h15l3-12" fill="#dbccb6"/><path d="m36 30 2-6 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#bfa9d7"/><circle cx="212" cy="50" r="5" fill="#e6c892"/></svg>`;
}

function shell() {
  app.innerHTML = `<div class="app-layout"><div class="sidebar-overlay" data-action="close-sidebar"></div><aside class="sidebar" aria-label="Navigation principale"><a class="brand" href="/" aria-label="Atelier SCI, accueil"><span class="brand-symbol">a<span>✳</span></span><span>atelier<span class="brand-period">.</span><small>SCI</small></span></a><button class="workspace-label" data-action="settings" aria-label="Paramètres de la SCI"><span class="workspace-avatar">${icon("building")}</span><span class="workspace-name">${esc(state.settings.name)}<small>${esc(fiscalLabel())}</small></span>${icon("down")}</button><div class="nav-section-label">VOTRE ESPACE</div><nav>${navItems.map(([id, ico, label]) => `<button class="nav-item ${view === id ? "active" : ""}" data-view="${id}" ${view === id ? 'aria-current="page"' : ""}>${icon(ico)}<span>${label}</span>${id === "properties" ? `<span class="nav-count">${state.properties.filter((p) => !p.archived).length}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-note"><span class="tiny-dot"></span>Suivi de trésorerie · ${esc(state.settings.taxRegime === "unknown" ? "régime à préciser" : state.settings.taxRegime)}</div><div class="sidebar-bottom"><div class="advisor-card">${icon("sparkle")}<strong>Les bons comptes,<br>l’esprit tranquille.</strong><p>Des opérations bien rangées pour travailler avec votre comptable.</p><button data-action="csv">Exporter mes opérations ${icon("arrow")}</button></div><button class="theme-button" data-action="theme">${icon(theme === "dark" ? "sun" : "moon")} Mode ${theme === "dark" ? "clair" : "sombre"}</button><div class="account-footer">${icon(user ? "lock" : "circle")}<span>${user ? esc(user.email) : "Espace de démonstration"}</span>${user ? `<button class="icon-button" data-action="logout" aria-label="Se déconnecter">${icon("logout")}</button>` : ""}</div></div></aside><main class="main"><header class="topbar"><button class="mobile-menu icon-button" data-action="sidebar" aria-label="Ouvrir la navigation">${icon("menu")}</button><div class="breadcrumb">Mon patrimoine ${icon("chevron")}<span>${titleFor()}</span></div><div class="topbar-right"><span class="sync-indicator ${dirty ? "warning" : ""}">${icon(user ? "lock" : "circle")}<span>${saving ? "Enregistrement…" : dirty ? "Non enregistré" : user ? "Enregistré en ligne" : "Mode démonstration"}</span></span><button class="profile-button" data-action="${user ? "settings" : "auth"}" aria-label="${user ? "Paramètres de la SCI" : "Créer mon compte"}">${user ? esc(state.settings.name.charAt(0).toUpperCase()) : icon("plus")}</button></div></header><div class="workspace-content"><div id="notice-area"></div><div class="page-heading"><div><div class="eyebrow">VOTRE PATRIMOINE, EN TOUTE CLARTÉ</div><h1>${titleFor()}<span>.</span></h1><p>${{ dashboard: "Les bons chiffres pour garder une longueur d’avance.", transactions: "Chaque mouvement, à sa place. Rien de plus, rien de moins.", properties: "Vos adresses, vos locataires, votre patrimoine.", backups: "Vos données vous appartiennent. Gardez-en une copie." }[view]}</p></div><button class="button primary" data-action="${view === "properties" ? "add-property" : "add-transaction"}">${icon("plus")}${view === "properties" ? "Ajouter un bien" : "Nouvelle opération"}</button></div><div id="page-content"></div><footer class="main-footer"><span>Atelier SCI · Un patrimoine bien accompagné.</span><span>Suivi de trésorerie · ${esc(fiscalLabel())}</span></footer></div></main></div>`;
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
          `<button class="pending-item" data-action="edit-transaction" data-id="${esc(t.id)}"><span class="pending-icon ${t.type}">${icon(t.type)}</span><span><strong>${esc(t.label)}</strong><small>${esc(propertyFor(t.propertyId)?.name || "SCI / Général")} · ${shortDate(t.date)}</small></span><b class="${t.type}">${money(t.amountCents)}</b></button>`,
      )
      .join("") ||
    `<div class="small-empty">${icon("check")}Aucune échéance en attente.</div>`
  }</div><button class="text-link" data-action="pending">Voir les opérations en attente ${icon("arrow")}</button><p class="micro-note">Les échéances proviennent de vos saisies. Elles ne sont pas générées automatiquement à partir des loyers.</p></section></div><section class="panel recent-panel"><div class="panel-heading"><div><h2>Dernières opérations</h2><p>Le détail derrière vos chiffres.</p></div><button class="text-link" data-view="transactions">Tout voir ${icon("arrow")}</button></div>${ledgerHTML(filterTransactions(state, { year, propertyId }).slice(0, 5))}</section><div class="accounting-note">${icon("receipt")}<p><strong>À partager avec votre comptable.</strong> Les montants suivent les flux de trésorerie. Le capital d’emprunt, les dépôts de garantie et les apports sont distingués des loyers. Les amortissements, le résultat fiscal à l’IS, la TVA éventuelle et les déclarations ne sont pas calculés ici.</p></div>`;
}
function chart(monthly) {
  const max = Math.max(...monthly.flatMap((m) => [m.income, m.expense]), 10000);
  const ceiling = Math.ceil(max / 10000) * 10000;
  const y = (value) => 180 - (value / ceiling) * 145;
  const bars = monthly
    .map(
      (m, i) =>
        `<g><rect x="${57 + i * 43}" y="${y(m.income)}" width="11" height="${180 - y(m.income)}" rx="3" fill="#9581d0"><title>${esc(m.label)} : encaissements ${money(m.income)}</title></rect><rect x="${71 + i * 43}" y="${y(m.expense)}" width="11" height="${180 - y(m.expense)}" rx="3" fill="#e4bf80"><title>${esc(m.label)} : décaissements ${money(m.expense)}</title></rect><text x="${69 + i * 43}" y="204" text-anchor="middle">${esc(m.label.replace(".", ""))}</text></g>`,
    )
    .join("");
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 590 220" role="img" aria-label="Encaissements et décaissements réglés par mois, en euros">${[0, 0.5, 1].map((r) => `<line x1="48" y1="${180 - r * 145}" x2="580" y2="${180 - r * 145}"/><text x="39" y="${184 - r * 145}" text-anchor="end">${Math.round((ceiling * r) / 100).toLocaleString("fr-FR")}</text>`).join("")}${bars}</svg></div><div class="sr-only"><table><caption>Mouvements mensuels réglés en euros</caption><thead><tr><th>Mois</th><th>Encaissements</th><th>Décaissements</th></tr></thead><tbody>${monthly.map((m) => `<tr><th>${esc(m.label)}</th><td>${money(m.income)}</td><td>${money(m.expense)}</td></tr>`).join("")}</tbody></table></div>`;
}
function ledgerHTML(rows) {
  if (!rows.length)
    return `<div class="empty-state">${icon("receipt")}<h3>Aucune opération pour le moment</h3><p>Ajoutez un premier mouvement ou ajustez vos filtres.</p><button class="button secondary" data-action="add-transaction">${icon("plus")}Ajouter une opération</button></div>`;
  return `<div class="table-scroll"><table class="ledger"><thead><tr><th>Date</th><th>Opération</th><th>Bien</th><th>Montant</th><th>Statut</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((t) => `<tr data-testid="operation-row" data-id="${esc(t.id)}"><td class="date-cell">${shortDate(t.date)}</td><td><div class="operation-cell"><span class="flow-icon ${t.type}">${icon(t.type)}</span><span><button class="operation-label" data-action="edit-transaction" data-id="${esc(t.id)}">${esc(t.label)}</button><small>${esc(categoryFor(t.category).label)}${t.reference ? ` · ${esc(t.reference)}` : ""}</small></span></div></td><td><span class="property-cell">${esc(propertyFor(t.propertyId)?.name || "SCI / Général")}</span></td><td class="amount ${t.type}">${t.type === "income" ? "+" : "−"} ${money(t.amountCents)}</td><td><span class="status-pill ${t.status}"><i></i>${t.status === "paid" ? "Réglée" : t.date < todayISO() ? "En retard" : "En attente"}</span></td><td><button class="icon-button" data-action="operation-menu" data-id="${esc(t.id)}" aria-label="Actions pour ${esc(t.label)}" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`;
}
function renderTransactions(content) {
  content.innerHTML = `${periodControls()}<section class="panel transactions-panel"><div class="panel-heading"><div><h2>Journal des mouvements</h2><p>Encaissements et décaissements, réglés ou prévus.</p></div><span class="year-chip">EUR</span></div><div class="ledger-toolbar"><div class="search-field">${icon("search")}<input id="search" type="search" placeholder="Rechercher une opération…" aria-label="Rechercher une opération" value="${esc(query)}"></div><select id="status-filter" aria-label="Filtrer par statut">${options(
    [
      { id: "all", label: "Tous les statuts" },
      { id: "paid", label: "Réglées" },
      { id: "pending", label: "En attente" },
    ],
    status,
  )}</select><select id="category-filter" aria-label="Filtrer par catégorie">${options([{ id: "all", label: "Toutes les catégories" }, ...CATEGORIES], category)}</select><button class="text-link" data-action="reset-filters">Réinitialiser</button></div><div id="ledger-results"></div></section>`;
  renderLedger();
}
function renderLedger() {
  const rows = filterTransactions(state, {
    year,
    propertyId,
    query,
    status,
    category,
  });
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  pageNumber = Math.min(pageNumber, pages);
  document.querySelector("#ledger-results").innerHTML =
    `${ledgerHTML(rows.slice((pageNumber - 1) * 12, pageNumber * 12))}<div class="table-footer"><span>${rows.length} opération${rows.length !== 1 ? "s" : ""} · Les opérations en attente n’affectent pas la trésorerie.</span><div><button class="icon-button" data-action="previous" aria-label="Page précédente" ${pageNumber === 1 ? "disabled" : ""}>${icon("chevron", "rotate")}</button><span>${pageNumber} / ${pages}</span><button class="icon-button" data-action="next" aria-label="Page suivante" ${pageNumber === pages ? "disabled" : ""}>${icon("chevron")}</button></div></div>`;
}
function renderProperties(content) {
  const active = state.properties.filter((p) => !p.archived);
  const rent = active.reduce((n, p) => n + p.rentCents, 0);
  content.innerHTML = `<div class="property-summary"><span>${icon("building")}<b>${active.length}</b> bien${active.length !== 1 ? "s" : ""} actif${active.length !== 1 ? "s" : ""}</span><span>Loyers mensuels de référence <strong>${money(rent)}</strong><small>Hors charges · ne constitue pas un encaissement</small></span></div><div class="properties-grid">${state.properties.map((p, i) => `<article class="property-card ${p.archived ? "archived" : ""}" data-testid="property-card"><div class="property-illustration tone-${i % 3}">${houseArt(["#9a88ca", "#8caa94", "#c0a176"][i % 3])}<span>${p.archived ? "Archivé" : "Bien locatif"}</span></div><div class="property-body"><h2>${esc(p.name)}</h2><p class="address">${esc(p.address || "Adresse à renseigner")}</p><div class="tenant">${icon("lock")}<span>Locataire<strong>${esc(p.tenant || "Non renseigné")}</strong></span></div><div class="rent-details"><div><span>Loyer mensuel HC</span><strong>${money(p.rentCents)}</strong></div><div><span>Provisions / mois</span><strong>${money(p.chargesCents)}</strong></div></div><div class="property-actions"><button class="text-link" data-action="edit-property" data-id="${esc(p.id)}">${icon("edit")}Modifier</button><button class="text-link muted" data-action="archive-property" data-id="${esc(p.id)}">${p.archived ? "Réactiver" : "Archiver"}</button></div></div></article>`).join("")}<button class="new-property-card" data-action="add-property">${icon("plus")}<strong>Une nouvelle adresse ?</strong><span>Ajouter un bien à votre patrimoine</span></button></div><div class="accounting-note">${icon("folder")}<p>Archiver un bien conserve son historique. Les opérations restent visibles dans le journal et les exports. Les loyers indiqués sur ces fiches servent de référence ; saisissez les échéances et les règlements dans les opérations.</p></div>`;
}
function renderBackups(content) {
  content.innerHTML = `<div class="backup-intro"><span class="backup-illustration">${icon("lock")}</span><h2>Votre SCI vous suit.<br>Vos données restent à vous.</h2><p>${user ? "Vos données sont enregistrées sur le serveur de votre compte. Une sauvegarde JSON permet aussi de conserver une copie indépendante." : "Explorez librement la démonstration. Créez un compte pour enregistrer votre SCI sur le serveur et la retrouver sur plusieurs appareils."}</p></div><div class="backup-grid"><section class="panel backup-card"><span class="feature-icon purple">${icon("download")}</span><h2>Une copie complète</h2><p>Biens, opérations et paramètres réunis dans un fichier JSON à conserver en lieu sûr.</p><button class="button primary" data-action="json">${icon("download")}Télécharger la sauvegarde</button></section><section class="panel backup-card"><span class="feature-icon green">${icon("upload")}</span><h2>Reprendre une sauvegarde</h2><p>Restaurez un fichier Atelier SCI. Un aperçu et une confirmation précèdent le remplacement de vos données.</p><button class="button secondary" data-action="import">${icon("upload")}Importer une sauvegarde</button><input id="import-file" type="file" accept=".json,application/json" hidden></section><section class="panel backup-card"><span class="feature-icon amber">${icon("receipt")}</span><h2>Pour votre comptable</h2><p>Export CSV des mouvements de l’année et du bien sélectionnés, lisible dans Excel. Cet export n’est pas un fichier FEC.</p><button class="button secondary" data-action="csv">${icon("download")}Exporter les opérations en CSV</button></section><section class="panel backup-card"><span class="feature-icon blue">${icon(user ? "building" : "lock")}</span><h2>${user ? "Votre espace personnel" : "Votre SCI, sur tous vos écrans"}</h2><p>${user ? `Connecté en tant que ${esc(user.email)}. Pour accéder à vos données ailleurs, connectez-vous à la même adresse du site avec ce compte.` : "Créez votre espace avec un e-mail et un mot de passe. Le compte démarre sans données de démonstration."}</p><button class="button secondary" data-action="${user ? "settings" : "auth"}">${icon(user ? "settings" : "plus")}${user ? "Paramètres de ma SCI" : "Créer mon compte"}</button></section></div><div class="notice">${icon("folder")}<span>Le fichier JSON contient les informations de votre SCI et de vos locataires. Conservez-le dans un emplacement privé. La synchronisation ne remplace pas une sauvegarde indépendante.</span></div>`;
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
  menu.innerHTML = `<button role="menuitem" data-action="edit-transaction" data-id="${esc(id)}">${icon("edit")}Modifier</button><button role="menuitem" data-action="toggle-paid" data-id="${esc(id)}">${icon(t.status === "paid" ? "clock" : "check")}${t.status === "paid" ? "Marquer en attente" : "Marquer comme réglée"}</button><div class="menu-divider"></div><button class="danger-text" role="menuitem" data-action="delete-transaction" data-id="${esc(id)}">${icon("trash")}Supprimer</button>`;
  document.body.append(menu);
  const r = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - 235, innerWidth - 243))}px`;
  const h = menu.offsetHeight;
  menu.style.top = `${r.bottom + h > innerHeight - 8 ? Math.max(8, r.top - h) : r.bottom + 5}px`;
  menuId = id;
  button.setAttribute("aria-expanded", "true");
  menu.querySelector("button").focus();
}
function closeDialog() {
  dialogRoot.querySelector("dialog")?.close();
  dialogRoot.innerHTML = "";
  if (lastFocus?.isConnected) lastFocus.focus();
}
function mountDialog(html) {
  lastFocus = menuId
    ? document.querySelector(
        `[data-action="operation-menu"][data-id="${CSS.escape(menuId)}"]`,
      )
    : document.activeElement;
  closeMenu();
  dialogRoot.innerHTML = html;
  const d = dialogRoot.querySelector("dialog");
  d.showModal();
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog();
  });
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closeDialog();
    }
  });
  d.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", closeDialog),
  );
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
  if (Object.keys(errors).length) {
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
function transactionForm(id) {
  if (!allowMutation()) return;
  const existing = state.transactions.find((t) => t.id === id);
  const t = existing || {
    id: uid(),
    date: todayISO(),
    type: "income",
    status: "paid",
    category: "rent",
    propertyId: propertyId === "all" ? "" : propertyId,
    label: "",
    amountCents: 0,
    counterparty: "",
    reference: "",
    notes: "",
  };
  const d = mountDialog(
    `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier l’opération" : "Nouvelle opération", "Un mouvement clair aujourd’hui, des comptes plus simples demain.", "receipt")}<div class="form-grid">${selectField(
      "type",
      "Type",
      [
        { id: "income", label: "Encaissement" },
        { id: "expense", label: "Décaissement" },
      ],
      t.type,
    )}${field("amount", "Montant (€) *", existing ? moneyInput(t.amountCents) : "", "text", 'inputmode="decimal" placeholder="0,00" required')}</div>${field("label", "Libellé *", t.label, "text", 'maxlength="160" required autofocus placeholder="Ex. : Loyer de novembre"')}<div class="form-grid">${selectField("propertyId", "Bien", selectableProperties(), t.propertyId)}${selectField(
      "category",
      "Catégorie",
      CATEGORIES.filter((c) => c.type === t.type),
      t.category,
    )}${field("date", "Date / échéance *", t.date, "date", "required")}${selectField(
      "status",
      "Statut",
      [
        { id: "paid", label: "Réglée" },
        { id: "pending", label: "En attente" },
      ],
      t.status,
    )}${field("counterparty", "Tiers / locataire", t.counterparty, "text", 'maxlength="160"')}${field("reference", "Référence de pièce", t.reference, "text", 'maxlength="100"')}</div><div class="form-field"><label for="field-notes">Notes</label><textarea name="notes" id="field-notes" rows="2" maxlength="3000">${esc(t.notes)}</textarea><span class="field-error" data-error="notes"></span></div><p class="form-note">Pour un règlement, indiquez la date effective du mouvement. Une opération « En attente » n’entre pas dans le solde de trésorerie.</p>${formFooter(existing ? "Enregistrer" : "Ajouter l’opération")}</form></dialog>`,
  );
  d.querySelector('[name="type"]').addEventListener("change", (e) => {
    d.querySelector('[name="category"]').innerHTML = options(
      CATEGORIES.filter((c) => c.type === e.target.value),
      "",
    );
  });
  d.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const result = validateTransaction(
      {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        id: t.id,
        dueDate: t.dueDate || "",
      },
      state,
    );
    if (showErrors(d, result.errors)) return;
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
function paymentForm(id) {
  const t = state.transactions.find((t) => t.id === id);
  if (!t || !allowMutation()) return;
  const d = mountDialog(
    `<dialog class="confirm-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader("Enregistrer le règlement", `${t.label} · ${money(t.amountCents)}`, "check")}${field("date", "Date du règlement *", todayISO(), "date", "required")}<p class="form-note">Indiquez la date effective d’encaissement ou de paiement. L’échéance initiale sera conservée dans l’export.</p>${formFooter("Enregistrer le règlement")}</form></dialog>`,
  );
  d.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const result = validateTransaction(
      {
        ...t,
        date: new FormData(e.currentTarget).get("date"),
        dueDate: t.dueDate || t.date,
        status: "paid",
        amount: moneyInput(t.amountCents),
      },
      state,
    );
    if (showErrors(d, result.errors)) return;
    state.transactions = state.transactions.map((row) =>
      row.id === id ? result.value : row,
    );
    closeDialog();
    persist("Le règlement a été enregistré à sa date effective.");
  });
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
    `<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier le bien" : "Ajouter un bien", "Une nouvelle adresse dans votre espace.", "building")}${field("name", "Nom du bien *", p.name, "text", 'maxlength="100" required autofocus placeholder="Ex. : Appartement du centre"')}${field("address", "Adresse", p.address, "text", 'maxlength="250"')}${field("tenant", "Locataire", p.tenant, "text", 'maxlength="160"')}<div class="form-grid">${field("rent", "Loyer mensuel hors charges (€)", moneyInput(p.rentCents), "text", 'inputmode="decimal"')}${field("charges", "Provisions mensuelles (€)", moneyInput(p.chargesCents), "text", 'inputmode="decimal"')}</div><p class="form-note">Ces montants sont des références. Ils ne génèrent pas automatiquement de quittance ou d’opération.</p>${formFooter(existing ? "Enregistrer" : "Ajouter le bien")}</form></dialog>`,
  );
  d.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const result = validateProperty({
      ...Object.fromEntries(new FormData(e.currentTarget)),
      id: p.id,
      archived: p.archived,
    });
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
    `<dialog class="auth-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(mode === "register" ? "Bienvenue chez vous." : "Content de vous retrouver.", "Votre SCI, accessible avec le même compte sur vos appareils.", "lock")}<div class="auth-tabs"><button type="button" data-auth="register" class="${mode === "register" ? "active" : ""}">Créer mon espace</button><button type="button" data-auth="login" class="${mode === "login" ? "active" : ""}">Se connecter</button></div>${mode === "register" ? field("name", "Nom de votre SCI", "Ma SCI", "text", 'maxlength="100" required') : ""}${field("email", "Adresse e-mail", "", "email", 'autocomplete="email" required')}${field("password", "Mot de passe", "", "password", `minlength="12" maxlength="128" autocomplete="${mode === "register" ? "new-password" : "current-password"}" required`)}<p class="form-note">${mode === "register" ? "Choisissez au moins 12 caractères. Votre compte commence avec une SCI à l’IS, sans les exemples de la démonstration." : "Utilisez les identifiants de votre compte Atelier SCI sur ce même serveur."}</p><p class="auth-error" role="alert"></p><button class="button primary auth-submit" type="submit">${icon("lock")}${mode === "register" ? "Créer mon compte" : "Se connecter"}</button></form></dialog>`,
  );
  d.querySelectorAll("[data-auth]").forEach((b) =>
    b.addEventListener("click", () => authDialog(b.dataset.auth)),
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
    exportCSV(state, rows),
    `atelier-sci-operations-${year}.csv`,
    "text/csv;charset=utf-8",
  );
  toast(
    `${rows.length} opération${rows.length !== 1 ? "s" : ""} exportée${rows.length !== 1 ? "s" : ""}.`,
  );
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
    if (t) {
      if (t.status === "pending") paymentForm(id);
      else {
        t.status = "pending";
        persist("Le statut de l’opération a été mis à jour.");
      }
    }
  } else if (action === "archive-property" && allowMutation()) {
    const p = propertyFor(id);
    if (p)
      confirmDialog(
        p.archived ? "Réactiver ce bien ?" : "Archiver ce bien ?",
        `L’historique de « ${p.name} » et ses opérations sont conservés.`,
        p.archived ? "Réactiver le bien" : "Archiver le bien",
        () => {
          p.archived = !p.archived;
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
      `atelier-sci-sauvegarde-${todayISO()}.json`,
      "application/json",
    );
  else if (action === "import") document.querySelector("#import-file")?.click();
  else if (action === "reset-filters") {
    query = "";
    category = "all";
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
app.innerHTML = '<div class="loading-state">Chargement de votre espace…</div>';
try {
  acceptSession(await api("/session"));
} catch (error) {
  if (error.status !== 401) serverUnavailable = true;
}
shell();
