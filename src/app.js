import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./style.css";
import {
  STATUS,
  PRIORITIES,
  PROJECTS,
  createInitialState,
  normalizeState,
  filterTasks,
  getStats,
  validateTask,
  formatDate,
  isOverdue,
} from "./model.js";

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  board:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  moon: '<path d="M20.8 13.1A9 9 0 0 1 10.9 3.2 9 9 0 1 0 20.8 13.1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  flag: '<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  sparkle:
    '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4m-2-2h4"/>',
  folder:
    '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.circle}</svg>`;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const STORAGE_KEY = "atelier.tasks.v1";
let storageProblem = false;
let state;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  state = saved ? normalizeState(JSON.parse(saved)) : createInitialState();
} catch {
  state = createInitialState();
  storageProblem = true;
}
let theme = "light";
try {
  theme = localStorage.getItem("atelier.theme") === "dark" ? "dark" : "light";
} catch {
  /* Memory-only mode remains usable. */
}
document.documentElement.dataset.theme = theme;
let project = "all";
let query = "";
let priority = "all";
let view = "board";
let activeMenu = null;
let dragging = null;
let toastTimer;
let lastFocus;
const app = document.querySelector("#app");
const dialogRoot = document.querySelector("#dialog-root");
const projectFor = (id) => PROJECTS.find((p) => p.id === id) || PROJECTS[0];
const priorityFor = (id) =>
  PRIORITIES.find((p) => p.id === id) || PRIORITIES[1];
const date = new Date().toLocaleDateString("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const illustration = `<svg class="hero-art" viewBox="0 0 360 168" fill="none" aria-hidden="true">
  <ellipse cx="198" cy="153" rx="131" ry="7" fill="#dcd5f0" opacity=".55"/>
  <path d="M76 136c-31-44-14-97 26-104 36-7 41 35 68 21 24-13 18-44 55-39 50 7 91 77 59 122" fill="#e5def7"/>
  <path d="M76 114c36-7 33-50 66-37s22 64 68 32 38-36 81-24" stroke="#c5b9e7" stroke-width="1.5" stroke-dasharray="4 5"/>
  <g transform="rotate(-9 154 91)"><rect x="109" y="35" width="88" height="113" rx="9" fill="#c6b9e8"/><rect x="102" y="29" width="88" height="113" rx="8" fill="#fff" stroke="#d0c7e5"/><rect x="127" y="24" width="39" height="12" rx="4" fill="#a38acc"/><rect x="118" y="52" width="13" height="13" rx="4" fill="#e9e2f7"/><path d="m121 58 3 3 5-6" stroke="#8f75c5" stroke-width="1.7" stroke-linecap="round"/><path d="M140 58h33M140 64h22" stroke="#ddd7e9" stroke-width="3" stroke-linecap="round"/><rect x="118" y="77" width="13" height="13" rx="4" fill="#e9e2f7"/><path d="m121 83 3 3 5-6" stroke="#8f75c5" stroke-width="1.7" stroke-linecap="round"/><path d="M140 83h29M140 89h19" stroke="#ddd7e9" stroke-width="3" stroke-linecap="round"/><rect x="118" y="102" width="13" height="13" rx="4" fill="#f4f1f8" stroke="#e2dceb"/><path d="M140 108h33M140 114h26" stroke="#e8e2ef" stroke-width="3" stroke-linecap="round"/></g>
  <g transform="rotate(13 243 98)"><rect x="205" y="71" width="72" height="66" rx="6" fill="#d6c893"/><rect x="201" y="66" width="72" height="66" rx="5" fill="#fff0ba"/><path d="M218 88h37M218 96h30M218 104h23" stroke="#d5bd77" stroke-width="2.5" stroke-linecap="round"/><path d="m248 114 3 3 6-7" stroke="#b29a56" stroke-width="2" stroke-linecap="round"/></g>
  <path d="M291 146v-28m0 10c-16-1-21-10-19-20 13-1 20 6 19 20Zm0-7c16-2 22-11 20-22-13-1-21 8-20 22Z" fill="#8eaf9a" stroke="#789a86" stroke-width="1.2"/><path d="m279 136 3 18h18l3-18" fill="#ede1cd" stroke="#d6c6b0"/>
  <path d="m72 56 2-7 2 7 7 2-7 2-2 7-2-7-7-2 7-2Zm192-24 1.5-5 1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5Z" fill="#bba9da"/>
  <circle cx="95" cy="103" r="3" fill="#baa9db"/><circle cx="241" cy="48" r="3" fill="#d9c17e"/>
</svg>`;

function renderShell() {
  app.innerHTML = `<div class="app-layout">
    <div class="sidebar-overlay" data-action="close-sidebar"></div>
    <aside class="sidebar" aria-label="Navigation principale">
      <a class="brand" href="/" aria-label="Atelier, accueil"><span class="brand-symbol">a<span>✳</span></span><span>atelier<span class="brand-period">.</span></span></a>
      <div class="workspace-label"><span class="workspace-avatar">M</span><span>Mon espace<span class="workspace-sub">Personnel</span></span><span class="workspace-spark">${icon("sparkle")}</span></div>
      <div class="nav-section-label">ESPACE DE TRAVAIL</div>
      <nav class="main-nav"><button class="nav-item active" data-project="all">${icon("grid")}<span>Tous les projets</span><span class="nav-count" id="all-count"></span></button></nav>
      <div class="nav-section-label project-section">MES PROJETS <span>${PROJECTS.length}</span></div>
      <nav class="project-nav">${PROJECTS.map((p) => `<button class="nav-item" data-project="${p.id}"><span class="project-dot ${p.id}"></span><span>${esc(p.label)}</span><span class="nav-count" data-count="${p.id}"></span></button>`).join("")}</nav>
      <div class="sidebar-bottom"><div class="idea-card"><span class="idea-icon">${icon("sparkle")}</span><strong>Une idée en tête ?</strong><p>Les grandes choses commencent par une petite tâche.</p><button class="idea-link" data-action="create">Notez-la ici ${icon("arrow")}</button></div>
      <button class="theme-button" data-action="theme">${icon(theme === "dark" ? "sun" : "moon")}<span>Passer au mode ${theme === "dark" ? "clair" : "sombre"}</span></button>
      <div class="privacy-note">${icon("lock")}<span>Votre espace. Vos données.</span></div></div>
    </aside>
    <main class="main">
      <header class="topbar"><button class="mobile-menu icon-button" aria-label="Ouvrir la navigation" data-action="sidebar">${icon("menu")}</button><div class="breadcrumb">Espace personnel ${icon("chevron")} <span>Vue d’ensemble</span></div><div class="topbar-right"><span class="today">${esc(date)}</span><span class="profile-avatar" aria-label="Mon espace personnel">M</span></div></header>
      <div class="workspace-content">
        <div class="page-heading"><div><div class="eyebrow">UN ESPACE POUR AVANCER</div><h1 id="page-title">Tous les projets<span class="title-dot">.</span></h1><p id="page-description">Un peu d’ordre pour laisser la place aux bonnes idées.</p></div><button class="button primary" data-action="create">${icon("plus")} Nouvelle tâche</button></div>
        <section class="welcome-banner" aria-label="Votre progression"><div class="welcome-copy"><span class="welcome-kicker">À VOTRE RYTHME ${icon("sparkle")}</span><h2>Chaque petit pas compte.</h2><p>Posez vos idées, organisez la suite.<br>Le plus beau reste à faire.</p><div class="banner-progress"><div class="progress-track"><div id="hero-progress"></div></div><span id="hero-progress-label"></span></div></div>${illustration}<div class="banner-sticker">Moins de bruit,<br><span>plus d’élan.</span><svg viewBox="0 0 90 12" fill="none" aria-hidden="true"><path d="M2 8C22 2 58 2 87 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div></section>
        <section class="stats" id="stats" aria-label="Résumé des tâches"></section>
        <section class="task-area" aria-labelledby="board-title"><div class="board-heading"><div class="board-heading-title"><h2 id="board-title">Votre tableau</h2><span id="task-total"></span></div><div class="view-switch" role="group" aria-label="Affichage"><button class="active" data-view="board" aria-label="Vue tableau" aria-pressed="true">${icon("board")}<span>Tableau</span></button><button data-view="list" aria-label="Vue liste" aria-pressed="false">${icon("list")}<span>Liste</span></button></div></div>
          <div class="toolbar"><div class="search-field">${icon("search")}<input type="search" id="search" placeholder="Rechercher une tâche…" aria-label="Rechercher une tâche" autocomplete="off"><span class="search-hint">/</span></div><div class="filter-field">${icon("flag")}<select id="priority-filter" aria-label="Filtrer par priorité"><option value="all">Toutes les priorités</option>${PRIORITIES.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}</select>${icon("down")}</div><button class="reset-filters" data-action="reset-filters" hidden>Effacer les filtres</button><div class="save-status" id="save-status">${icon("check")}<span>Sauvegarde automatique</span></div></div>
          <div id="board"></div>
        </section>
        <footer class="main-footer"><span>Faites de la place à ce qui compte.</span><span>Créé avec soin. À vous de jouer ${icon("sparkle")}</span></footer>
      </div>
    </main>
  </div>`;
  app.querySelector("#search").addEventListener("input", (e) => {
    query = e.target.value;
    renderBoard();
  });
  app.querySelector("#priority-filter").addEventListener("change", (e) => {
    priority = e.target.value;
    renderBoard();
  });
  renderWorkspace();
}

function selectedTasks() {
  return filterTasks(state.tasks, { project });
}

function renderWorkspace() {
  const tasks = selectedTasks();
  const stats = getStats(tasks);
  const name =
    project === "all" ? "Tous les projets" : projectFor(project).label;
  document.querySelector("#page-title").innerHTML =
    `${esc(name)}<span class="title-dot">.</span>`;
  document.title = `${name} — Atelier`;
  document.querySelectorAll(".nav-item").forEach((el) => {
    const active = el.dataset.project === project;
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.querySelector("#all-count").textContent = state.tasks.length;
  PROJECTS.forEach((p) => {
    document.querySelector(`[data-count="${p.id}"]`).textContent =
      state.tasks.filter((t) => t.project === p.id).length;
  });
  const cards = [
    {
      label: "Total des tâches",
      key: "total",
      icon: "grid",
      className: "purple",
      caption: "De belles choses en préparation",
    },
    {
      label: "À faire",
      key: "todo",
      icon: "circle",
      className: "gray",
      caption: "Le début de quelque chose",
    },
    {
      label: "En cours",
      key: "doing",
      icon: "clock",
      className: "amber",
      caption: "Ça prend forme, continuez !",
    },
    {
      label: "Terminées",
      key: "done",
      icon: "check",
      className: "green",
      caption: "Une bonne raison de sourire",
    },
  ];
  document.querySelector("#stats").innerHTML = cards
    .map(
      (c) =>
        `<div class="stat-card"><div class="stat-top"><span>${c.label}</span><span class="stat-icon ${c.className}">${icon(c.icon)}</span></div><div class="stat-value">${stats[c.key]}<span>${c.key === "done" ? `<span class="mini-progress">${stats.progress}%</span>` : ""}</span></div><div class="stat-caption">${c.caption}</div></div>`,
    )
    .join("");
  document.querySelector("#hero-progress").style.width = `${stats.progress}%`;
  document.querySelector("#hero-progress-label").textContent =
    `${stats.done} sur ${stats.total} tâches accomplies`;
  document
    .querySelector("#save-status")
    .classList.toggle("save-warning", storageProblem);
  document.querySelector("#save-status span").textContent = storageProblem
    ? "Sauvegarde indisponible"
    : "Sauvegarde automatique";
  renderBoard();
}

function taskCard(t) {
  const p = projectFor(t.project);
  const pr = priorityFor(t.priority);
  const overdue = isOverdue(t);
  return `<article class="task-card ${t.status === "done" ? "completed" : ""}" draggable="true" data-testid="task-card" data-task="${esc(t.id)}" tabindex="0" aria-label="${esc(t.title)}">
    <div class="card-top"><span class="project-tag ${p.id}"><span></span>${esc(p.label)}</span><button class="icon-button card-menu-button" data-action="task-menu" data-id="${esc(t.id)}" aria-label="Actions pour ${esc(t.title)}" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button></div>
    <button class="task-title" data-action="edit" data-id="${esc(t.id)}">${esc(t.title)}</button>
    ${t.description ? `<p class="task-description">${esc(t.description)}</p>` : ""}
    <div class="card-meta"><span class="priority-pill ${t.priority}"><span></span>${esc(pr.label)}</span>${t.status === "done" ? `<span class="complete-label">${icon("check")} Bien joué !</span>` : ""}</div>
    <div class="card-footer"><span class="task-date ${overdue ? "overdue" : ""}">${icon("calendar")}${t.dueDate ? esc(formatDate(t.dueDate)) : "Sans échéance"}${overdue ? '<span class="overdue-dot" title="En retard"></span>' : ""}</span><button class="task-complete ${t.status === "done" ? "is-done" : ""}" data-action="complete" data-id="${esc(t.id)}" aria-label="${t.status === "done" ? "Rouvrir" : "Terminer"} ${esc(t.title)}" title="${t.status === "done" ? "Rouvrir la tâche" : "Marquer comme terminée"}">${icon("check")}</button></div>
  </article>`;
}

function renderBoard() {
  closeMenu();
  const tasks = filterTasks(state.tasks, { query, priority, project });
  document.querySelector("#task-total").textContent =
    `${tasks.length} tâche${tasks.length !== 1 ? "s" : ""}`;
  document.querySelector(".reset-filters").hidden = !(
    query || priority !== "all"
  );
  const board = document.querySelector("#board");
  board.className = view === "list" ? "list-view" : "kanban-board";
  if (!tasks.length && (query || priority !== "all")) {
    board.className = "";
    board.innerHTML = `<div class="empty-results"><span class="empty-icon">${icon("search")}</span><h3>Aucune tâche trouvée</h3><p>Essayez un autre mot ou ajustez vos filtres.</p><button class="button secondary" data-action="reset-filters">Effacer les filtres</button></div>`;
    return;
  }
  board.innerHTML = STATUS.map((s) => {
    const group = tasks.filter((t) => t.status === s.id);
    return `<section class="kanban-column ${s.id}" data-status="${s.id}" aria-label="${esc(s.label)}"><div class="column-heading"><span class="status-dot"></span><h3>${esc(s.label)}</h3><span class="column-count">${group.length}</span><button class="icon-button" data-action="create" data-status="${s.id}" aria-label="Ajouter une tâche dans ${esc(s.label)}">${icon("plus")}</button></div><div class="column-tasks">${group.map(taskCard).join("")}${!group.length ? `<div class="empty-column">${icon(s.id === "done" ? "sparkle" : "circle")}<span>${s.id === "done" ? "Les petites victoires arrivent ici." : "Un peu de place pour la suite."}</span></div>` : ""}</div><button class="add-card" data-action="create" data-status="${s.id}">${icon("plus")} Ajouter une tâche</button></section>`;
  }).join("");
}

function persist(message) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageProblem = false;
  } catch {
    storageProblem = true;
  }
  renderWorkspace();
  toast(
    storageProblem
      ? "Sauvegarde impossible : vos changements restent dans cet onglet."
      : message,
  );
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.innerHTML = `${icon(storageProblem ? "flag" : "check")}<span>${esc(message)}</span>`;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3800);
}

function closeMenu(restoreFocus = false) {
  const trigger = activeMenu
    ? document.querySelector(
        `[data-action="task-menu"][data-id="${CSS.escape(activeMenu)}"]`,
      )
    : null;
  document.querySelector("#task-menu")?.remove();
  if (activeMenu)
    document
      .querySelector(
        `[data-action="task-menu"][data-id="${CSS.escape(activeMenu)}"]`,
      )
      ?.setAttribute("aria-expanded", "false");
  activeMenu = null;
  if (restoreFocus) trigger?.focus();
}

function showMenu(id, button) {
  const wasOpen = activeMenu === id;
  closeMenu();
  if (wasOpen) return;
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const menu = document.createElement("div");
  menu.id = "task-menu";
  menu.className = "task-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button role="menuitem" data-action="edit" data-id="${esc(id)}">${icon("edit")}Modifier</button><div class="menu-divider"></div>${STATUS.filter(
    (s) => s.id !== task.status,
  )
    .map(
      (s) =>
        `<button role="menuitem" data-action="move" data-id="${esc(id)}" data-status="${s.id}">${icon(s.id === "done" ? "check" : "arrow")}Déplacer vers ${esc(s.label)}</button>`,
    )
    .join(
      "",
    )}<div class="menu-divider"></div><button role="menuitem" class="danger-text" data-action="delete" data-id="${esc(id)}">${icon("trash")}Supprimer</button>`;
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - 240, innerWidth - 248))}px`;
  const height = menu.getBoundingClientRect().height;
  menu.style.top = `${rect.bottom + height > innerHeight - 12 ? Math.max(8, rect.top - height) : rect.bottom + 5}px`;
  activeMenu = id;
  button.setAttribute("aria-expanded", "true");
  menu.querySelector("button").focus();
}

function closeDialog() {
  const dialog = dialogRoot.querySelector("dialog");
  if (dialog?.open) dialog.close();
  dialogRoot.innerHTML = "";
  if (lastFocus?.isConnected) lastFocus.focus();
}

function mountDialog(html) {
  lastFocus = activeMenu
    ? document.querySelector(
        `[data-action="task-menu"][data-id="${CSS.escape(activeMenu)}"]`,
      )
    : document.activeElement;
  closeMenu();
  dialogRoot.innerHTML = html;
  const dialog = dialogRoot.querySelector("dialog");
  dialog.showModal();
  dialog.addEventListener("click", (e) => {
    if (
      e.target === dialog &&
      (e.clientX < dialog.getBoundingClientRect().left ||
        e.clientX > dialog.getBoundingClientRect().right ||
        e.clientY < dialog.getBoundingClientRect().top ||
        e.clientY > dialog.getBoundingClientRect().bottom)
    )
      closeDialog();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog();
  });
  dialog
    .querySelectorAll('[data-action="close-dialog"]')
    .forEach((b) => b.addEventListener("click", closeDialog));
  return dialog;
}

function showTaskForm(id, status = "todo") {
  const existing = state.tasks.find((t) => t.id === id);
  const task = existing || {
    title: "",
    description: "",
    project: project === "all" ? PROJECTS[0].id : project,
    priority: "medium",
    status,
    dueDate: "",
  };
  const options = (list, value) =>
    list
      .map(
        (x) =>
          `<option value="${x.id}" ${x.id === value ? "selected" : ""}>${esc(x.label)}</option>`,
      )
      .join("");
  const dialog = mountDialog(
    `<dialog class="task-dialog" aria-labelledby="dialog-title"><form id="task-form" novalidate><div class="dialog-heading"><span class="dialog-mark">${icon(existing ? "edit" : "plus")}</span><button type="button" class="icon-button" aria-label="Fermer" data-action="close-dialog">${icon("close")}</button></div><h2 id="dialog-title">${existing ? "Modifier la tâche" : "Nouvelle tâche"}</h2><p class="dialog-description">${existing ? "Un petit ajustement pour garder le cap." : "Une idée de plus, un premier pas vers la suite."}</p><div class="form-field"><label for="task-title">Titre <span>*</span></label><input id="task-title" name="title" placeholder="Qu’avez-vous envie de faire avancer ?" value="${esc(task.title)}" maxlength="120" required autofocus><span class="field-error" id="title-error"></span></div><div class="form-field"><label for="task-description">Description</label><textarea id="task-description" name="description" placeholder="Quelques détails, un lien, une idée…" rows="3" maxlength="3000">${esc(task.description)}</textarea></div><div class="form-grid"><div class="form-field"><label for="task-project">Projet</label><select id="task-project" name="project">${options(PROJECTS, task.project)}</select></div><div class="form-field"><label for="task-priority">Priorité</label><select id="task-priority" name="priority">${options(PRIORITIES, task.priority)}</select></div><div class="form-field"><label for="task-status">Statut</label><select id="task-status" name="status">${options(STATUS, task.status)}</select></div><div class="form-field"><label for="task-date">Échéance</label><input id="task-date" name="dueDate" type="date" value="${esc(task.dueDate)}"><span class="field-error" id="date-error"></span></div></div><div class="dialog-footer"><button type="button" class="button secondary" data-action="close-dialog">Annuler</button><button type="submit" class="button primary">${icon("check")}${existing ? "Enregistrer" : "Créer la tâche"}</button></div></form></dialog>`,
  );
  dialog.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const result = validateTask(
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    const errors = result.errors;
    dialog.querySelector("#title-error").textContent = errors.title || "";
    dialog.querySelector("#date-error").textContent = errors.dueDate || "";
    dialog
      .querySelector("#task-title")
      .setAttribute("aria-invalid", String(!!errors.title));
    dialog
      .querySelector("#task-title")
      .setAttribute("aria-describedby", "title-error");
    if (Object.keys(errors).length) {
      dialog.querySelector(errors.title ? "#task-title" : "#task-date").focus();
      return;
    }
    if (existing)
      state.tasks = state.tasks.map((t) =>
        t.id === id ? { ...t, ...result.value } : t,
      );
    else
      state.tasks.push({
        ...result.value,
        id:
          globalThis.crypto?.randomUUID?.() ||
          `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
      });
    closeDialog();
    persist(
      existing
        ? "La tâche a été mise à jour."
        : "Une nouvelle idée prend sa place.",
    );
  });
}

function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const dialog = mountDialog(
    `<dialog class="confirm-dialog" aria-labelledby="delete-title"><span class="delete-mark">${icon("trash")}</span><h2 id="delete-title">Supprimer cette tâche ?</h2><p>« ${esc(task.title)} » sera supprimée de votre tableau.</p><div class="dialog-footer"><button class="button secondary" data-action="close-dialog">Annuler</button><button class="button danger" id="confirm-delete">Supprimer la tâche</button></div></dialog>`,
  );
  dialog.querySelector("#confirm-delete").addEventListener("click", () => {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    closeDialog();
    persist("La tâche a été supprimée.");
  });
}

function moveTask(id, status) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status === status || !STATUS.some((s) => s.id === status))
    return;
  task.status = status;
  persist(
    status === "done"
      ? "Une petite victoire de plus. Bien joué !"
      : `Tâche déplacée vers « ${STATUS.find((s) => s.id === status).label} ».`,
  );
}

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action], [data-project], [data-view]");
  if (
    !e.target.closest("#task-menu") &&
    !e.target.closest('[data-action="task-menu"]')
  )
    closeMenu();
  if (!target || target.closest("dialog")) return;
  if (target.dataset.project) {
    project = target.dataset.project;
    document.body.classList.remove("sidebar-open");
    renderWorkspace();
    return;
  }
  if (target.dataset.view) {
    view = target.dataset.view;
    document.querySelectorAll("[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    });
    renderBoard();
    return;
  }
  const { action, id, status } = target.dataset;
  if (action === "create") showTaskForm(null, status);
  else if (action === "edit") showTaskForm(id);
  else if (action === "delete") deleteTask(id);
  else if (action === "task-menu") showMenu(id, target);
  else if (action === "move") moveTask(id, status);
  else if (action === "complete") {
    const task = state.tasks.find((t) => t.id === id);
    if (task) moveTask(id, task.status === "done" ? "todo" : "done");
  } else if (action === "reset-filters") {
    query = "";
    priority = "all";
    document.querySelector("#search").value = "";
    document.querySelector("#priority-filter").value = "all";
    renderBoard();
  } else if (action === "sidebar") document.body.classList.add("sidebar-open");
  else if (action === "close-sidebar")
    document.body.classList.remove("sidebar-open");
  else if (action === "theme") {
    theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("atelier.theme", theme);
    } catch {
      /* Theme still applies for this session. */
    }
    target.innerHTML = `${icon(theme === "dark" ? "sun" : "moon")}<span>Passer au mode ${theme === "dark" ? "clair" : "sombre"}</span>`;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMenu(true);
    document.body.classList.remove("sidebar-open");
  }
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName,
    ) &&
    !dialogRoot.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    document.querySelector("#search").focus();
  }
  if (
    e.target.closest("#task-menu") &&
    ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    const buttons = [...document.querySelectorAll("#task-menu button")];
    const index = buttons.indexOf(document.activeElement);
    buttons[
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
    ].focus();
  }
  if (["Enter", " "].includes(e.key) && e.target.matches(".task-card")) {
    e.preventDefault();
    showTaskForm(e.target.dataset.task);
  }
});

document.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".task-card");
  if (!card) return;
  dragging = card.dataset.task;
  e.dataTransfer.setData("text/plain", dragging);
  e.dataTransfer.effectAllowed = "move";
  setTimeout(() => card.classList.add("dragging"), 0);
});
document.addEventListener("dragover", (e) => {
  const column = e.target.closest(".kanban-column");
  if (!column || !dragging) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".drag-over").forEach((c) => {
    if (c !== column) c.classList.remove("drag-over");
  });
  column.classList.add("drag-over");
});
document.addEventListener("dragleave", (e) => {
  const c = e.target.closest(".kanban-column");
  if (c && !c.contains(e.relatedTarget)) c.classList.remove("drag-over");
});
document.addEventListener("drop", (e) => {
  const column = e.target.closest(".kanban-column");
  if (!column || !dragging) return;
  e.preventDefault();
  moveTask(dragging, column.dataset.status);
  dragging = null;
  document
    .querySelectorAll(".drag-over,.dragging")
    .forEach((c) => c.classList.remove("drag-over", "dragging"));
});
document.addEventListener("dragend", () => {
  dragging = null;
  document
    .querySelectorAll(".drag-over,.dragging")
    .forEach((c) => c.classList.remove("drag-over", "dragging"));
});
window.addEventListener("resize", closeMenu);
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY || dialogRoot.querySelector("dialog[open]")) return;
  try {
    if (e.newValue) {
      state = normalizeState(JSON.parse(e.newValue));
      renderWorkspace();
    }
  } catch {
    /* Ignore an invalid write from another tab. */
  }
});
renderShell();
if (storageProblem)
  toast("Les données enregistrées n’ont pas pu être chargées.");
