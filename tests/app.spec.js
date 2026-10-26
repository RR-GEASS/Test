import { completeEntry } from "./entry-helpers.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createEmptyState, serializeBackup } from "../src/model.js";
const password = "browser-test-password-2026";
const row = (page, title) =>
  page.getByTestId("operation-row").filter({ hasText: title });
async function register(page) {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await page
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de votre SCI").fill("SCI des Tests");
  await dialog.getByLabel("Adresse e-mail").fill(email);
  await dialog.getByLabel("Mot de passe").fill(password);
  await dialog
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
  return email;
}
async function addProperty(page, name = "Appartement Érable") {
  await page
    .getByRole("button", { name: "Biens immobiliers", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Ajouter un bien", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nom court du bien *").fill(name);
  await d.getByLabel("Adresse", { exact: true }).fill("Rue des Tests");

  await d.getByLabel("Loyer mensuel hors charges (€)").fill("800,50");
  await d.getByRole("button", { name: "Ajouter le bien", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByTestId("property-card").filter({ hasText: name }),
  ).toBeVisible();
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
}
async function addTransaction(page, label = "Loyer de test", settings = {}) {
  if (
    !(await page
      .getByRole("button", { name: "Nouvelle opération", exact: true })
      .count())
  )
    await navigate(page, "Vue d’ensemble");
  await page
    .getByRole("button", { name: "Nouvelle opération", exact: true })
    .click();
  const d = page.getByRole("dialog");
  if (settings.type)
    await d.getByLabel("Type", { exact: true }).selectOption(settings.type);
  await d
    .getByLabel("Catégorie", { exact: true })
    .selectOption(
      settings.category ||
        (settings.type === "expense" ? "other_expense" : "other_income"),
    );
  await d.getByLabel("Détail (facultatif)").fill(label);
  await d.getByLabel("Montant (€) *").fill(settings.amount || "800,50");
  await d
    .getByLabel("Date / échéance *")
    .fill(settings.date || `${new Date().getFullYear()}-01-01`);
  await d
    .getByLabel("Statut", { exact: true })
    .selectOption(settings.status || "paid");
  if (settings.property)
    await d
      .getByLabel("Bien", { exact: true })
      .selectOption({ label: settings.property });
  await completeEntry(page,d);
  await completeEntry(page,d);
  await d
    .getByRole("button", { name: "Ajouter l’opération", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
}
async function navigate(page, name) {
  await page
    .locator("aside nav")
    .getByRole("button", {
      name: name === "Biens immobiliers" ? /^Biens immobiliers/ : name,
      exact: name !== "Biens immobiliers",
    })
    .click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Vue d’ensemble." }),
  ).toBeVisible();
});
test("la démonstration présente des chiffres et des données explicitement fictives", async ({
  page,
}) => {
  await expect(
    page.getByText("Biens, locataires et montants fictifs.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("metric-0")).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Encaissements et décaissements réglés par mois, en euros",
    }),
  ).toBeVisible();
  await navigate(page, "Biens immobiliers");
  await expect(page.getByTestId("property-card")).toHaveCount(3);
});
test("un compte démarre vide, les biens et opérations persistent après rechargement", async ({
  page,
}) => {
  await register(page);
  await expect(page.getByTestId("operation-row")).toHaveCount(0);
  await addProperty(page);
  await addTransaction(page, "Loyer Érable", {
    property: "Appartement Érable",
  });
  await navigate(page, "Opérations");
  await expect(row(page, "Loyer Érable")).toContainText("800,50");
  await page.reload();
  await navigate(page, "Opérations");
  await expect(row(page, "Loyer Érable")).toHaveCount(1);
  await expect(row(page, "Loyer Érable")).toContainText("Appartement Érable");
});
test("les montants invalides sont refusés puis une opération peut être modifiée et supprimée", async ({
  page,
}) => {
  await register(page);
  await page
    .getByRole("button", { name: "Nouvelle opération", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Catégorie", { exact: true }).selectOption("other_income");
  await d.getByLabel("Détail (facultatif)").fill("Réparation à modifier");
  await d.getByLabel("Montant (€) *").fill("1,005");
  await completeEntry(page,d);
  await d
    .getByRole("button", { name: "Ajouter l’opération", exact: true })
    .click();
  await expect(d).toBeVisible();
  await expect(d.locator("[data-error=amount]")).toBeVisible();
  await d.getByLabel("Montant (€) *").fill("125,90");
  await completeEntry(page,d);
  await d
    .getByRole("button", { name: "Ajouter l’opération", exact: true })
    .click();
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Opérations");
  await row(page, "Réparation à modifier")
    .locator("[data-action=operation-menu]")
    .click();
  await page.getByRole("menuitem", { name: "Modifier", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Détail (facultatif)")
    .fill("Réparation modifiée");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(row(page, "Réparation modifiée")).toHaveCount(1);
  await row(page, "Réparation modifiée")
    .locator("[data-action=operation-menu]")
    .click();
  await page.getByRole("menuitem", { name: "Supprimer", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Supprimer l’opération", exact: true })
    .click();
  await expect(row(page, "Réparation modifiée")).toHaveCount(0);
  await page.reload();
  await navigate(page, "Opérations");
  await expect(row(page, "Réparation modifiée")).toHaveCount(0);
});
test("une échéance en attente n’affecte pas le solde puis un règlement le modifie", async ({
  page,
}) => {
  await register(page);
  await addTransaction(page, "Loyer en attente", {
    amount: "900,25",
    status: "pending",
  });
  await expect(page.getByTestId("metric-2")).toContainText("0,00");
  await expect(page.getByTestId("metric-3")).toContainText("900,25");
  await navigate(page, "Opérations");
  await row(page, "Loyer en attente")
    .locator("[data-action=operation-menu]")
    .click();
  await page
    .getByRole("menuitem", { name: "Enregistrer un règlement" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enregistrer le règlement", exact: true })
    .click();
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Vue d’ensemble");
  await expect(page.getByTestId("metric-2")).toContainText("900,25");
  await expect(page.getByTestId("metric-3")).toContainText("0,00");
});
test("le même compte retrouve ses données sur un second navigateur", async ({
  page,
  browser,
}) => {
  const email = await register(page);
  await addTransaction(page, "Partagé entre appareils", { amount: "321,09" });
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await other.goto("/");
    await other
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();
    await other.getByRole("dialog").locator("[data-auth=login]").click();
    await other.getByRole("dialog").getByLabel("Adresse e-mail").fill(email);
    await other.getByRole("dialog").getByLabel("Mot de passe").fill(password);
    await other.getByRole("dialog").locator("button[type=submit]").click();
    await expect(other.getByRole("dialog")).not.toBeVisible();
    await navigate(other, "Opérations");
    await expect(row(other, "Partagé entre appareils")).toContainText("321,09");
    await addTransaction(other, "Ajouté sur le second appareil", {
      amount: "50",
    });
    await page.reload();
    await navigate(page, "Opérations");
    await expect(row(page, "Ajouté sur le second appareil")).toHaveCount(1);
  } finally {
    await otherContext.close();
  }
});
test("les filtres combinent recherche sans accents, bien et statut", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await addTransaction(page, "Réparation chaudière", {
    property: "Appartement Érable",
    status: "pending",
    type: "expense",
    category: "maintenance",
  });
  await addTransaction(page, "Autre recette", { amount: "50" });
  await navigate(page, "Opérations");
  await page
    .getByLabel("Filtrer par bien")
    .selectOption({ label: "Appartement Érable" });
  await page
    .getByPlaceholder("Rechercher une opération…")
    .fill("reparation chaudiere");
  await expect(page.getByTestId("operation-row")).toHaveCount(1);
  await page.getByLabel("Filtrer par statut").selectOption("paid");
  await expect(page.getByTestId("operation-row")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Réinitialiser", exact: true })
    .click();
  await expect(page.getByTestId("operation-row")).toHaveCount(2);
});
test("les exports CSV et JSON se téléchargent et un import invalide conserve les données", async ({
  page,
}) => {
  await register(page);
  await addTransaction(page, "Opération à sauvegarder");
  await navigate(page, "Opérations");
  let pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exporter en CSV", exact: true })
    .click();
  const csv = await pending;
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  await navigate(page, "Sauvegardes");
  pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger la sauvegarde", exact: true })
    .click();
  const json = await pending;
  expect(json.suggestedFilename()).toMatch(/\.json$/);
  await page.locator("#import-file").setInputFiles({
    name: "incorrect.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await expect(page.getByRole("status")).toContainText("JSON valide");
  await navigate(page, "Opérations");
  await expect(row(page, "Opération à sauvegarder")).toHaveCount(1);
});
test("la restauration demande une confirmation avant de remplacer les données", async ({
  page,
}) => {
  await register(page);
  await navigate(page, "Sauvegardes");
  const backup = createEmptyState();
  backup.settings.name = "SCI restaurée";
  await page.locator("#import-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeBackup(backup)),
  });
  await expect(page.getByRole("dialog")).toContainText("SCI restaurée");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Annuler", exact: true })
    .click();
  await expect(
    page.locator("aside").getByRole("button", { name: "Paramètres de la SCI" }),
  ).toContainText("SCI des Tests");
  await page.locator("#import-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeBackup(backup)),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remplacer mes données" })
    .click();
  await expect(
    page.locator("aside").getByRole("button", { name: "Paramètres de la SCI" }),
  ).toContainText("SCI restaurée");
});
test("les paramètres du solde, l’archivage et le mode sombre sont conservés", async ({
  page,
}) => {
  await register(page);
  await page
    .locator("aside")
    .getByRole("button", { name: "Paramètres de la SCI", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Solde initial (€) *")
    .fill("1250,55");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(page.getByTestId("metric-2")).toContainText("1");
  await expect(page.getByTestId("metric-2")).toContainText("250,55");
  await addProperty(page);
  await page
    .getByTestId("property-card")
    .getByRole("button", { name: "Archiver", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archiver le bien", exact: true })
    .click();
  await expect(page.getByTestId("property-card")).toContainText("Archivé");
  await page.getByRole("button", { name: "Mode sombre", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await navigate(page, "Biens immobiliers");
  await expect(page.getByTestId("property-card")).toContainText("Archivé");
});
test("le téléphone permet de naviguer et d’ouvrir un formulaire sans débordement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Nouvelle opération", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await page
    .locator("aside")
    .getByRole("button", { name: "Biens immobiliers", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Biens immobiliers." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const theme of ["light", "dark"])
  test(`accessibilité automatique du tableau et du formulaire (${theme})`, async ({
    page,
  }) => {
    if (theme === "dark")
      await page
        .getByRole("button", { name: "Mode sombre", exact: true })
        .click();
    let result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page
      .getByRole("button", { name: "Nouvelle opération", exact: true })
      .click();
    result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  });
test("un conflit entre appareils conserve la version du serveur et propose de récupérer les modifications", async ({
  page,
  browser,
}) => {
  await register(page);
  const otherContext = await browser.newContext();
  try {
    await otherContext.addCookies(await page.context().cookies());
    const other = await otherContext.newPage();
    await other.goto("/");
    await expect(
      other.getByRole("heading", { name: "Vue d’ensemble." }),
    ).toBeVisible();
    await other
      .getByRole("button", { name: "Nouvelle opération", exact: true })
      .click();
    const d = other.getByRole("dialog");
    await d
      .getByLabel("Catégorie", { exact: true })
      .selectOption("other_income");
    await d.getByLabel("Détail (facultatif)").fill("Modification concurrente");
    await d.getByLabel("Montant (€) *").fill("25");
    await addTransaction(page, "Mouvement déjà enregistré", { amount: "100" });
    await completeEntry(other,d);
    await d
      .getByRole("button", { name: "Ajouter l’opération", exact: true })
      .click();
    await expect(other.getByRole("alert")).toContainText("autre appareil");
    await expect(
      other.getByText("Non enregistré", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", {
        name: "Exporter mes modifications",
        exact: true,
      }),
    ).toBeVisible();
    await other
      .getByRole("button", { name: "Recharger le serveur", exact: true })
      .click();
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Recharger", exact: true })
      .click();
    await expect(
      other.getByText("Enregistré en ligne", { exact: true }),
    ).toBeVisible();
    await navigate(other, "Opérations");
    await expect(row(other, "Mouvement déjà enregistré")).toHaveCount(1);
    await expect(row(other, "Modification concurrente")).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});
test("une session interrompue permet de se reconnecter sans perdre l’opération en cours", async ({
  page,
}) => {
  await register(page);
  await page
    .getByRole("button", { name: "Nouvelle opération", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Catégorie", { exact: true }).selectOption("other_income");
  await d.getByLabel("Détail (facultatif)").fill("Règlement après reconnexion");
  await d.getByLabel("Montant (€) *").fill("75,30");
  await page.evaluate(() =>
    fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  await completeEntry(page,d);
  await d
    .getByRole("button", { name: "Ajouter l’opération", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Se reconnecter", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Se reconnecter", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("Mot de passe").fill(password);
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await navigate(page, "Opérations");
  await expect(row(page, "Règlement après reconnexion")).toHaveCount(1);
});
test("les libellés restent du texte dans les confirmations de suppression", async ({
  page,
}) => {
  await register(page);
  const label = '<img src=x onerror="window.__sciInjected=true">';
  await addTransaction(page, label);
  await navigate(page, "Opérations");
  await row(page, label).locator("[data-action=operation-menu]").click();
  await page.getByRole("menuitem", { name: "Supprimer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(label);
  await expect(dialog.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__sciInjected)).toBeUndefined();
});
