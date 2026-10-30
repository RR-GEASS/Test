import { test, expect } from "@playwright/test";
import { revealNav } from "./navigation.js";

const top = page => page.locator("dialog[open]").last();
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

async function register(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  const dialog = top(page);
  await dialog.getByLabel("Nom de votre SCI").fill("SCI confirmations");
  await dialog.getByLabel("Adresse e-mail").fill(`feedback-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await dialog.getByLabel("Mot de passe").fill("feedback-password-2026");
  await dialog.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

async function navigate(page, name) {
  const button = page.locator("aside nav").getByRole("button", { name, exact: true });
  await revealNav(page, button);
  await button.click();
}

async function newOperation(page, label = "Recette à confirmer") {
  await page.getByRole("button", { name: "Nouvelle opération", exact: true }).click();
  const dialog = top(page);
  await dialog.getByLabel("Catégorie", { exact: true }).selectOption("other_income");
  await dialog.getByLabel("Détail (facultatif)").fill(label);
  await dialog.getByLabel("Montant (€) *").fill("75,30");
  await dialog.locator("[name=counterparty]").fill("Associé des tests");
  return dialog;
}

async function savedState(page) {
  return page.evaluate(async () => (await (await fetch("/api/session")).json()).state);
}

async function expectToastOnTop(page) {
  const toast = page.locator("#toast");
  await expect(toast).toHaveClass(/visible/);
  expect(await toast.evaluate(element => {
    const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
    const previous = element.style.pointerEvents;
    element.style.pointerEvents = "auto";
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    element.style.pointerEvents = previous;
    return dialog?.contains(element) && element.matches(":popover-open") && Boolean(hit?.closest("#toast"));
  })).toBe(true);
}

test("la saisie attend la réponse du serveur avant de se fermer et bloque une double validation", async ({ page }) => {
  await register(page);
  const dialog = await newOperation(page);
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  let saves = 0;
  await page.route("**/api/state", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    saves++;
    started();
    await gate;
    await route.continue();
  });
  try {
    await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
    await requestStarted;
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Ajouter l’opération", exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("Montant (€) *")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(1);
  } finally {
    release();
  }
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator("#toast")).toContainText("L’opération a été ajoutée.");
  await expect(page.locator("#toast")).toHaveAttribute("role", "status");
  expect(saves).toBe(1);
  expect((await savedState(page)).transactions).toHaveLength(1);
});

test("une erreur reste visible au-dessus des fenêtres et la saisie corrigée se réessaie sans doublon", async ({ page }) => {
  await register(page);
  const dialog = await newOperation(page);
  let saves = 0;
  await page.route("**/api/state", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    if (++saves === 1) return route.fulfill({ status: 503, json: { error: "Enregistrement indisponible pour ce test." } });
    return route.continue();
  });
  await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(dialog.locator(".dialog-save-error")).toContainText("Enregistrement indisponible pour ce test.");
  await expect(dialog.getByLabel("Montant (€) *")).toHaveValue("75,30");
  await expect(page.locator("#toast")).toHaveAttribute("role", "alert");
  await expectToastOnTop(page);
  await dialog.getByRole("button", { name: "Aide pour cette fiche", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  await expectToastOnTop(page);
  await top(page).getByRole("button", { name: "J’ai compris", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expectToastOnTop(page);
  await dialog.getByLabel("Montant (€) *").fill("80");
  await dialog.getByLabel("Détail (facultatif)").fill("Recette corrigée");
  await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const saved = await savedState(page);
  expect(saves).toBe(2);
  expect(saved.transactions).toHaveLength(1);
  expect(saved.transactions[0]).toMatchObject({ amountCents: 8000, detail: "Recette corrigée" });
});

test("un règlement réessayé reste unique et remplace l’ancien historique ouvert", async ({ page }) => {
  await register(page);
  await page.evaluate(async date => {
    const session = await (await fetch("/api/session")).json();
    session.state.transactions = [{
      id: "feedback-payment", propertyId: "", type: "income", category: "other_income",
      date, dueDate: date, status: "pending", label: "Recette partiellement réglée", normalizedLabel: false,
      amountCents: 10000, counterparty: "Associé des tests", notes: "", reference: "",
      payments: [{ id: "first-payment", date, amountCents: 2500, rentCents: 0, chargesCents: 0 }],
    }];
    const response = await fetch("/api/test-fixtures/state", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: session.state, revision: session.revision, accountId: session.user.id }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, today());
  await page.reload();
  await navigate(page, "Pointage mensuel");
  await page.getByRole("button", { name: "Règlements", exact: true }).click();
  await top(page).getByRole("button", { name: "Ajouter un règlement", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  const dialog = top(page);
  await expect(dialog.getByRole("heading", { name: "Enregistrer le règlement", exact: true })).toBeVisible();
  await dialog.getByLabel("Montant réglé (€) *").fill("30");
  let saves = 0;
  await page.route("**/api/state", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    if (++saves === 1) return route.fulfill({ status: 503, json: { error: "Réessayez ce règlement." } });
    return route.continue();
  });
  await dialog.getByRole("button", { name: "Enregistrer le règlement", exact: true }).click();
  await expect(dialog.locator(".dialog-save-error")).toContainText("Réessayez ce règlement.");
  await dialog.getByRole("button", { name: "Enregistrer le règlement", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const saved = (await savedState(page)).transactions[0];
  expect(saved.payments).toHaveLength(2);
  expect(saved.payments.map(payment => payment.amountCents).sort((a, b) => a - b)).toEqual([2500, 3000]);
  await page.getByRole("button", { name: "Règlements", exact: true }).click();
  await expect(top(page).locator(".payment-list li")).toHaveCount(2);
  await expect(top(page).locator("p.form-note").first()).toContainText("55,00");
});

test("les champs invalides restent corrigeables avant toute sauvegarde", async ({ page }) => {
  await register(page);
  const dialog = await newOperation(page);
  await dialog.getByLabel("Montant (€) *").fill("0");
  await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(dialog.locator(".validation-summary")).toBeVisible();
  await expect(dialog.getByLabel("Montant (€) *")).toHaveAttribute("aria-invalid", "true");
  expect((await savedState(page)).transactions).toHaveLength(0);
  await dialog.getByLabel("Montant (€) *").fill("42");
  await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect((await savedState(page)).transactions[0].amountCents).toBe(4200);
});

test("le guide des justificatifs explique les pièces attendues et reste utilisable sur téléphone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await navigate(page, "Guide des justificatifs");
  await expect(page.getByRole("heading", { name: "Guide des justificatifs." })).toBeVisible();
  await expect(page.getByText("Sans facture ne veut pas dire sans trace.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quand cocher « Justificatif non nécessaire » ?", exact: true })).toBeVisible();
  await expect(page.locator(".document-guide-card:visible")).toHaveCount(15);
  const search = page.getByRole("searchbox", { name: "Rechercher dans le guide des justificatifs", exact: true });
  await search.fill("mensualite");
  await expect(page.locator(".document-guide-card:visible")).toHaveCount(1);
  await expect(page.locator(".document-guide-card:visible")).toContainText("Échéance de prêt");
  await expect(page.locator(".document-guide-card:visible")).toContainText("une seule échéance de prêt");
  await page.getByLabel("Filtrer les exemples par type d’opération", { exact: true }).selectOption("income");
  await expect(page.locator("#document-guide-empty")).toBeVisible();
  await search.fill("");
  expect(await page.locator(".document-guide-card:visible").count()).toBeGreaterThan(0);
  await expect(page.locator(".document-guide-card:visible .document-guide-kind.expense")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("le guide ouvert depuis une saisie la conserve et garde ses champs accessibles au-dessus de sa propre page", async ({ page }) => {
  await register(page);
  const operation = await newOperation(page, "Recette avec consultation du guide");
  await operation.locator("[name=notes]").fill("Note conservée pendant la consultation.");
  await operation.getByRole("button", { name: "Quels justificatifs conserver ?", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  const guide = top(page);
  await expect(guide.getByRole("heading", { name: "Guide des justificatifs", exact: true })).toBeVisible();
  await guide.getByRole("searchbox", { name: "Rechercher dans le guide des justificatifs", exact: true }).fill("mensualite");
  await expect(guide.locator(".document-guide-card:visible")).toHaveCount(1);
  await guide.getByRole("button", { name: "Fermer le guide", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expect(operation.getByLabel("Détail (facultatif)")).toHaveValue("Recette avec consultation du guide");
  await expect(operation.getByLabel("Montant (€) *")).toHaveValue("75,30");
  await expect(operation.locator("[name=notes]")).toHaveValue("Note conservée pendant la consultation.");
  await operation.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await navigate(page, "Guide des justificatifs");
  const pageSearch = page.locator("#page-content").getByRole("searchbox", { name: "Rechercher dans le guide des justificatifs", exact: true });
  await pageSearch.fill("loyer");
  await page.getByRole("button", { name: "Aide de cette page", exact: true }).click();
  await top(page).getByRole("button", { name: "Guide des justificatifs", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  const modalSearch = top(page).getByRole("searchbox", { name: "Rechercher dans le guide des justificatifs", exact: true });
  await expect(modalSearch).toHaveCount(1);
  await modalSearch.fill("mensualite");
  await expect(top(page).locator(".document-guide-card:visible")).toHaveCount(1);
  await expect(top(page).locator(".document-guide-card:visible")).toContainText("Échéance de prêt");
  expect(await page.evaluate(() => {
    const counts = new Map();
    document.querySelectorAll("[id]").forEach(element => counts.set(element.id, (counts.get(element.id) || 0) + 1));
    return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  })).toEqual([]);
  await top(page).getByRole("button", { name: "Fermer le guide", exact: true }).click();
  await top(page).getByRole("button", { name: "J’ai compris", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(pageSearch).toHaveValue("loyer");
});
