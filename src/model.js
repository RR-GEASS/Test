export const STATUS = Object.freeze([
  { id: "todo", label: "À faire" },
  { id: "doing", label: "En cours" },
  { id: "done", label: "Terminé" },
]);

export const PRIORITIES = Object.freeze([
  { id: "high", label: "Haute" },
  { id: "medium", label: "Moyenne" },
  { id: "low", label: "Basse" },
]);

export const PROJECTS = Object.freeze([
  { id: "website", label: "Site web", color: "#8270e5" },
  { id: "personal", label: "Personnel", color: "#d79455" },
  { id: "ideas", label: "Boîte à idées", color: "#5aa18e" },
]);

const hasId = (items, id) => items.some((item) => item.id === id);
const text = (value) => (typeof value === "string" ? value.trim() : "");

function localDate(value = new Date()) {
  if (typeof value === "string" && validDate(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return localDate();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function offsetDate(days, today = new Date()) {
  const result = new Date(today);
  result.setDate(result.getDate() + days);
  return localDate(result);
}

export function createInitialState() {
  const createdAt = new Date().toISOString();
  const seed = [
    [
      "website",
      "todo",
      "high",
      "Dessiner la page d’accueil",
      "Poser les premières idées : une accroche claire, quelques couleurs et beaucoup d’espace.",
      2,
    ],
    [
      "personal",
      "todo",
      "medium",
      "Préparer la semaine",
      "Choisir trois petites victoires à accomplir cette semaine.",
      3,
    ],
    [
      "ideas",
      "todo",
      "low",
      "Imaginer la suite",
      "Un mode sombre ? Des raccourcis clavier ? Garder une place pour les bonnes idées.",
      7,
    ],
    [
      "website",
      "doing",
      "high",
      "Trouver une identité visuelle",
      "Explorer une palette chaleureuse et une typographie qui donne envie de créer.",
      0,
    ],
    [
      "personal",
      "doing",
      "medium",
      "Faire de la place aux projets",
      "Réserver un petit moment chaque jour pour avancer, même de quinze minutes.",
      1,
    ],
    [
      "ideas",
      "doing",
      "low",
      "Collectionner les inspirations",
      "Rassembler les sites, images et détails qui méritent un deuxième regard.",
      4,
    ],
    [
      "website",
      "done",
      "medium",
      "Donner un nom au projet",
      "Un nom simple et un endroit où toutes les idées peuvent prendre forme.",
      -2,
    ],
    [
      "personal",
      "done",
      "low",
      "Faire le premier pas",
      "Créer son espace et se lancer. Le plus difficile est déjà derrière vous.",
      -1,
    ],
    [
      "website",
      "done",
      "high",
      "Préparer l’espace de travail",
      "Un dépôt, quelques outils et tout ce qu’il faut pour construire la suite.",
      -1,
    ],
  ];
  return {
    version: 1,
    tasks: seed.map(
      ([project, status, priority, title, description, days], index) => ({
        id: `demo-${index + 1}`,
        title,
        description,
        status,
        priority,
        project,
        dueDate: offsetDate(days),
        createdAt,
      }),
    ),
  };
}

export function validateTask(values = {}) {
  const source = values && typeof values === "object" ? values : {};
  const value = {
    title: text(source.title),
    description: text(source.description),
    project: source.project ?? "website",
    priority: source.priority ?? "medium",
    status: source.status ?? "todo",
    dueDate: text(source.dueDate),
  };
  const errors = {};
  if (!value.title) errors.title = "Donnez un titre à votre tâche.";
  else if (value.title.length > 120)
    errors.title = "Le titre doit contenir au maximum 120 caractères.";
  if (value.description.length > 3000)
    errors.description =
      "La description doit contenir au maximum 3 000 caractères.";
  if (!hasId(PROJECTS, value.project))
    errors.project = "Choisissez un projet valide.";
  if (!hasId(PRIORITIES, value.priority))
    errors.priority = "Choisissez une priorité valide.";
  if (!hasId(STATUS, value.status))
    errors.status = "Choisissez un statut valide.";
  if (value.dueDate && !validDate(value.dueDate))
    errors.dueDate = "Choisissez une date valide.";
  return { errors, value };
}

export function normalizeState(input) {
  let source = input;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return createInitialState();
    }
  }
  if (!source || typeof source !== "object" || !Array.isArray(source.tasks))
    return createInitialState();
  const seenIds = new Set();
  const tasks = [];
  for (const [index, task] of source.tasks.entries()) {
    if (!task || typeof task !== "object" || !text(task.title)) continue;
    const { value } = validateTask({
      title: text(task.title).slice(0, 120),
      description: text(task.description).slice(0, 3000),
      project: hasId(PROJECTS, task.project) ? task.project : "website",
      priority: hasId(PRIORITIES, task.priority) ? task.priority : "medium",
      status: hasId(STATUS, task.status) ? task.status : "todo",
      dueDate: validDate(task.dueDate) ? task.dueDate : "",
    });
    let id = text(task.id) || `restored-${index + 1}`;
    while (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    const createdAt =
      typeof task.createdAt === "string" &&
      !Number.isNaN(Date.parse(task.createdAt))
        ? new Date(task.createdAt).toISOString()
        : new Date().toISOString();
    tasks.push({ id, ...value, createdAt });
  }
  return { version: 1, tasks };
}

const searchable = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae");

export function filterTasks(
  tasks,
  { query = "", project = "all", priority = "all" } = {},
) {
  const needle = searchable(query).trim();
  return tasks.filter((task) => {
    if (project !== "all" && task.project !== project) return false;
    if (priority !== "all" && task.priority !== priority) return false;
    const projectLabel =
      PROJECTS.find((item) => item.id === task.project)?.label ?? "";
    return (
      !needle ||
      searchable(`${task.title} ${task.description} ${projectLabel}`).includes(
        needle,
      )
    );
  });
}

export function isOverdue(task, today = new Date()) {
  return (
    task.status !== "done" &&
    validDate(task.dueDate) &&
    task.dueDate < localDate(today)
  );
}

export function getStats(tasks, today = new Date()) {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  return {
    total,
    done,
    doing: tasks.filter((task) => task.status === "doing").length,
    todo: tasks.filter((task) => task.status === "todo").length,
    overdue: tasks.filter((task) => isOverdue(task, today)).length,
    progress: total ? Math.round((done / total) * 100) : 0,
  };
}

export function nextStatus(status) {
  const index = STATUS.findIndex((item) => item.id === status);
  return STATUS[(index + 1) % STATUS.length].id;
}

export function formatDate(dateString) {
  if (!validDate(dateString)) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day));
}
