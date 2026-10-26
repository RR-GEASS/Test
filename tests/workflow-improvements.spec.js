import { completeEntry } from "./entry-helpers.js";
import { test, expect } from "@playwright/test";

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
const topDialog = (page) => page.locator("dialog[open]").last();
async function saved(page) {
  await expect(page.getByText("Enregistré en ligne", { exact: true })).toBeVisible();
}
async function navigate(page, name) {
  await page.locator("aside nav").getByRole("button", { name, exact: true }).click();
}
async function session(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error(`Session HTTP ${response.status}`);
    return response.json();
  });
}
async function register(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  const dialog = topDialog(page);
  await dialog.getByLabel("Nom de votre SCI").fill("SCI des contrôles");
  await dialog.getByLabel("Adresse e-mail").fill(`workflow-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await dialog.getByLabel("Mot de passe").fill("workflow-browser-password-2026");
  await dialog.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await saved(page);
}
function transaction(id, overrides = {}) {
  return { id, date: today(), dueDate: "", type: "expense", status: "pending", label: `Facture ${id}`, category: "maintenance", propertyId: "", amountCents: 12500, counterparty: "Artisan Test", reference: `FAC-${id}`, notes: "Intervention de test", ...overrides };
}
async function seed(page, transactions) {
  const result = await page.evaluate(async (rows) => {
    const account = await (await fetch("/api/session")).json();
    account.state.transactions = rows;
    const response = await fetch("/api/test-fixtures/state", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: account.state, revision: account.revision, accountId: account.user.id }),
    });
    return { ok: response.ok, body: await response.json() };
  }, transactions);
  expect(result.ok, JSON.stringify(result.body)).toBe(true);
  await page.reload();
  await navigate(page, "Opérations");
}
async function newExpense(page, { amount = "125", reference = "FAC-original" } = {}) {
  await page.getByRole("button", { name: "Nouvelle opération", exact: true }).click();
  const dialog = topDialog(page);
  await dialog.getByLabel("Type", { exact: true }).selectOption("expense");
  await dialog.getByLabel("Catégorie", { exact: true }).selectOption("maintenance");
  await dialog.locator('[name="amount"]').fill(amount);
  await completeEntry(page,dialog,"Artisan Test");
  await dialog.locator('[name="reference"]').fill(reference);
  return dialog;
}

test("dupliquer une opération conserve sa saisie utile sans recopier règlement, facture ni document", async ({ page }) => {
  await register(page);
  const original = transaction("original", {
    status: "paid", payments: [{ id: "payment-original", date: today(), amountCents: 12500, rentCents: 0, chargesCents: 0 }],
  });
  await seed(page, [original]);
  const upload = await page.evaluate(async () => {
    const response = await fetch("/api/transactions/original/attachments", {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": "facture.pdf" },
      body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF",
    });
    return response.status;
  });
  expect(upload).toBe(201);
  await page.getByTestId("operation-row").getByRole("button", { name: /^Actions pour / }).click();
  await page.getByRole("menuitem", { name: "Dupliquer", exact: true }).click();
  const dialog = topDialog(page);
  await expect(dialog.locator('[name="reference"]')).toHaveValue("");
  await expect(dialog.locator('[name="status"]')).toHaveValue("pending");
  await expect(dialog.locator('[name="counterparty"]')).toHaveValue("Artisan Test");
  await dialog.locator('[name="amount"]').fill("126");
  await completeEntry(page,dialog,"Artisan Test");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await saved(page);
  const state = (await session(page)).state;
  expect(state.transactions).toHaveLength(2);
  const copy = state.transactions.find((row) => row.id !== original.id);
  expect(copy).toMatchObject({ amountCents: 12600, status: "pending", reference: "", counterparty: original.counterparty });
  expect(copy.payments ?? []).toHaveLength(0);
  expect(copy.recurrenceId || "").toBe("");
  expect(state.transactions.find((row) => row.id === original.id).payments).toEqual(original.payments);
  const counts = await page.evaluate(async () => (await (await fetch("/api/attachments/summary")).json()).counts);
  expect(counts.original).toBe(1);
  expect(counts[copy.id] || 0).toBe(0);
});

test("un doublon probable demande une confirmation et peut être enregistré volontairement", async ({ page }) => {
  await register(page);
  await seed(page, [transaction("original")]);
  const dialog = await newExpense(page);
  await completeEntry(page,dialog,"Artisan Test");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/doublon|semblable|similaire|existe/i);
  expect((await session(page)).state.transactions).toHaveLength(1);
  await completeEntry(page,dialog,"Artisan Test");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await saved(page);
  expect((await session(page)).state.transactions).toHaveLength(2);
});

test("le filtre des pièces manquantes distingue les justificatifs non nécessaires", async ({ page }) => {
  await register(page);
  await seed(page, [transaction("manquante"), transaction("dispensee", { amountCents: 20000, documentNotRequired: true })]);
  const filter = page.getByLabel("Filtrer les justificatifs", { exact: true });
  await filter.selectOption("missing");
  await expect(page.getByTestId("operation-row")).toHaveCount(1);
  await expect(page.getByTestId("operation-row")).toContainText("Facture manquante");
  await filter.selectOption("not-required");
  await expect(page.getByTestId("operation-row")).toHaveCount(1);
  await expect(page.getByTestId("operation-row")).toContainText("Facture dispensee");
  await filter.selectOption("all");
  await page.getByTestId("operation-row").filter({ hasText: "Facture manquante" }).locator('[data-action="edit-transaction"]').click();
  await topDialog(page).getByLabel("Justificatif non nécessaire", { exact: true }).check();
  await completeEntry(page,topDialog(page),"Artisan Test");
  await topDialog(page).locator('button[type="submit"]').click();
  await saved(page);
  await filter.selectOption("missing");
  await expect(page.getByTestId("operation-row")).toHaveCount(0);
  await page.reload();
  expect((await session(page)).state.transactions.every((row) => row.documentNotRequired)).toBe(true);
});

test("créer un fournisseur depuis une opération conserve la saisie et une fermeture accidentelle est protégée", async ({ page }) => {
  await register(page);
  await navigate(page, "Opérations");
  const operation = await newExpense(page, { amount: "89,50", reference: "FACT-NEW" });
  await operation.locator('[name="detail"]').fill("Dépannage à conserver");
  await operation.getByRole("button", { name: "Créer un fournisseur", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  const supplier = topDialog(page);
  await supplier.locator('[name="name"]').fill("Plomberie Horizon");
  await supplier.locator('button[type="submit"]').click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await saved(page);
  await expect(topDialog(page).locator('[name="detail"]')).toHaveValue("Dépannage à conserver");
  await expect(topDialog(page).locator('[name="amount"]')).toHaveValue("89,50");
  await topDialog(page).getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(topDialog(page)).toContainText("Abandonner les modifications");
  await topDialog(page).getByRole("button", { name: "Continuer la saisie", exact: true }).click();
  await expect(topDialog(page).locator('[name="detail"]')).toHaveValue("Dépannage à conserver");
  await completeEntry(page,topDialog(page),"Artisan Test");
  await topDialog(page).locator('button[type="submit"]').click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await saved(page);
  const state = (await session(page)).state;
  const created=state.suppliers.find(s=>s.name==="Plomberie Horizon");
  expect(created).toBeTruthy();
  expect(state.transactions[0]).toMatchObject({ supplierId: created.id, amountCents: 8950 });
});
