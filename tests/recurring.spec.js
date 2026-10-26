import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const password = "recurring-browser-password-2026";
const propertyName = "République T2";
const firstOfMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

async function navigate(page, name) {
  const button = page
    .locator("aside nav")
    .getByRole("button", {
      name: name === "Biens immobiliers" ? /^Biens immobiliers/ : name,
      exact: name !== "Biens immobiliers",
    });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await button.click();
}

async function waitForSave(page) {
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
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
  await page
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de votre SCI").fill("SCI des échéances");
  await dialog
    .getByLabel("Adresse e-mail")
    .fill(`periodic-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await dialog.getByLabel("Mot de passe").fill(password);
  await dialog
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await waitForSave(page);
}

async function addProperty(page, name = propertyName) {
  await navigate(page, "Biens immobiliers");
  await page.getByRole("button", { name: "Ajouter un bien", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom court du bien *").fill(name);
  await dialog.getByLabel("Adresse", { exact: true }).fill("12 rue de la République");
  await dialog.getByLabel("Locataire", { exact: true }).fill("Locataire de test");
  await dialog.getByLabel("Loyer mensuel hors charges (€)").fill("800");
  await dialog.getByLabel("Provisions mensuelles (€)").fill("50");
  await dialog.getByRole("button", { name: "Ajouter le bien", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await waitForSave(page);
}

async function createRecurrence(page, { expense = false } = {}) {
  await navigate(page, "Opérations périodiques");
  await page
    .getByRole("button", { name: "Nouvelle périodicité", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Type", { exact: true })
    .selectOption(expense ? "expense" : "income");
  await dialog
    .getByLabel("Bien", { exact: true })
    .selectOption({ label: propertyName });
  await dialog
    .getByLabel("Catégorie", { exact: true })
    .selectOption(expense ? "insurance" : "rent");
  await dialog.getByLabel("Fréquence", { exact: true }).selectOption("monthly");
  await dialog.getByLabel("Date de début *").fill(firstOfMonth());
  if (expense) {
    await dialog.getByLabel("Montant (€) *").fill("42");
    await dialog.getByLabel("Détail", { exact: true }).fill("Assurance PNO");
  } else {
    await dialog.getByLabel("Loyer hors charges (€) *").fill("800");
    await dialog.getByLabel("Provisions sur charges (€)").fill("50");
  }
  await dialog
    .getByRole("button", { name: "Créer la périodicité", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await waitForSave(page);
}

test("une périodicité de loyer crée une échéance normalisée sans doubler les mouvements au rechargement", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await createRecurrence(page);
  await expect(page.getByTestId("recurrence-card")).toHaveCount(1);

  const before = (await session(page)).state;
  expect(before.recurrences).toHaveLength(1);
  expect(before.transactions).toHaveLength(1);
  expect(before.transactions[0]).toMatchObject({
    type: "income",
    category: "rent",
    amountCents: 85000,
    rentCents: 80000,
    chargesCents: 5000,
    status: "pending",
  });

  await navigate(page, "Opérations");
  const row = page.getByTestId("operation-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Encaissement");
  await expect(row).toContainText(propertyName);
  await expect(row).toContainText(/loyer/i);
  const month = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(new Date());
  await expect(row).toContainText(new RegExp(month, "i"));

  await page.reload();
  const after = (await session(page)).state;
  expect(after.transactions.map((transaction) => transaction.id)).toEqual(
    before.transactions.map((transaction) => transaction.id),
  );
  await navigate(page, "Vue d’ensemble");
  await expect(page.getByTestId("metric-2")).toContainText("0,00");
});

test("un paiement partiel unique ventile le loyer et les provisions et conserve le reste à recevoir", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await createRecurrence(page);
  await navigate(page, "Pointage mensuel");
  const pointing = page.getByTestId("pointing-row");
  await expect(pointing).toHaveCount(1);
  await pointing.getByRole("button", { name: "Paiement partiel", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Montant réglé (€) *").fill("425");
  const asNumber = (value) => Number(value.replace(",", "."));
  await expect
    .poll(async () => asNumber(await dialog.getByLabel("Part loyer (€)").inputValue()))
    .toBe(400);
  await expect
    .poll(async () => asNumber(await dialog.getByLabel("Part provisions (€)").inputValue()))
    .toBe(25);
  await dialog
    .getByRole("button", { name: "Enregistrer le règlement", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await waitForSave(page);
  await expect(page.getByTestId("pointing-row")).toContainText("Partiellement réglé");

  const saved = (await session(page)).state.transactions[0];
  expect(saved.payments).toHaveLength(1);
  expect(saved.payments[0]).toMatchObject({
    amountCents: 42500,
    rentCents: 40000,
    chargesCents: 2500,
  });
  await navigate(page, "Vue d’ensemble");
  await expect(page.getByTestId("metric-0")).toContainText("400,00");
  await expect(page.getByTestId("metric-2")).toContainText("425,00");
  await expect(page.getByTestId("metric-3")).toContainText("425,00");
  await page.reload();
  expect((await session(page)).state.transactions[0].payments).toHaveLength(1);
});

test("le pointage groupé valide uniquement les échéances cochées et leurs montants réels", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await createRecurrence(page);
  await createRecurrence(page, { expense: true });
  await navigate(page, "Pointage mensuel");
  await expect(page.getByTestId("pointing-row")).toHaveCount(2);
  await page
    .getByTestId("pointing-row")
    .filter({ hasText: /loyer/i })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Valider les règlements", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Valider les règlements", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await waitForSave(page);
  let selected = (await session(page)).state.transactions;
  expect(selected.find((transaction) => transaction.type === "income").status).toBe("paid");
  expect(selected.find((transaction) => transaction.type === "expense").status).toBe("pending");

  await page.getByRole("checkbox", { name: "Tout sélectionner", exact: true }).check();
  await page.getByRole("button", { name: "Valider les règlements", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Valider les règlements", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await waitForSave(page);

  const saved = (await session(page)).state;
  expect(saved.transactions).toHaveLength(2);
  for (const transaction of saved.transactions) {
    expect(transaction.payments).toHaveLength(1);
    expect(transaction.payments[0].amountCents).toBe(transaction.amountCents);
    expect(transaction.status).toBe("paid");
  }
  await navigate(page, "Vue d’ensemble");
  await expect(page.getByTestId("metric-0")).toContainText("800,00");
  await expect(page.getByTestId("metric-1")).toContainText("42,00");
  await expect(page.getByTestId("metric-2")).toContainText("808,00");
  await expect(page.getByTestId("metric-3")).toContainText("0,00");
});

test("le prévisionnel montre douze mois sans transformer les recettes attendues en trésorerie réelle", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await createRecurrence(page);
  await navigate(page, "Prévisionnel");
  await expect(page.getByRole("heading", { name: "Prévisionnel." })).toBeVisible();
  await expect(page.getByTestId("forecast-row")).toHaveCount(12);
  const nextMonth = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  await expect(
    page.getByTestId("forecast-row").filter({ hasText: new RegExp(nextMonth, "i") }),
  ).toContainText("850,00");
  expect((await session(page)).state.transactions).toHaveLength(1);
  await navigate(page, "Vue d’ensemble");
  await expect(page.getByTestId("metric-2")).toContainText("0,00");
});

test("mettre une périodicité en pause conserve son historique et suspend ses futures prévisions", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await createRecurrence(page);
  const card = page.getByTestId("recurrence-card");
  await card.getByRole("button", { name: /pause/i }).click();
  await waitForSave(page);
  expect((await session(page)).state.recurrences[0].active).toBe(false);
  const pendingIds = (await session(page)).state.transactions.map((transaction) => transaction.id);

  await navigate(page, "Prévisionnel");
  const nextMonth = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  const future = page.getByTestId("forecast-row").filter({ hasText: new RegExp(nextMonth, "i") });
  await expect(future).not.toContainText("850,00");
  await navigate(page, "Opérations périodiques");
  await page.getByTestId("recurrence-card").getByRole("button", { name: /reprendre/i }).click();
  await waitForSave(page);
  const resumed = (await session(page)).state;
  expect(resumed.recurrences[0].active).toBe(true);
  expect(resumed.transactions.map((transaction) => transaction.id)).toEqual(pendingIds);
});

test("un nom court déjà attribué à un bien ne peut pas être créé une deuxième fois", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await page.getByRole("button", { name: "Ajouter un bien", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom court du bien *").fill("  république t2  ");
  await dialog.getByRole("button", { name: "Ajouter le bien", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nom court du bien *")).toHaveAttribute("aria-invalid", "true");
  expect((await session(page)).state.properties).toHaveLength(1);
});

test("un justificatif PDF peut être ajouté, téléchargé puis supprimé sans accepter un faux PDF", async ({
  page,
}) => {
  await register(page);
  await addProperty(page);
  await createRecurrence(page);
  await navigate(page, "Opérations");
  await page
    .getByTestId("operation-row")
    .getByRole("button", { name: /^Actions pour / })
    .click();
  await page.getByRole("menuitem", { name: "Justificatifs", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const content = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  const filename = "Facture de novembre.pdf";
  await dialog.getByLabel("Ajouter un justificatif", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: content,
  });
  const link = dialog.getByRole("link", { name: filename, exact: true });
  await expect(link).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await link.click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe(filename);
  expect(await readFile(await download.path())).toEqual(content);

  await dialog.getByLabel("Ajouter un justificatif", { exact: true }).setInputFiles({
    name: "document-factice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<html><script>alert('not a PDF')</script></html>"),
  });
  await expect(dialog.getByRole("alert")).not.toBeEmpty();
  await expect(link).toHaveCount(1);
  await expect(dialog.getByRole("link", { name: "document-factice.pdf", exact: true })).toHaveCount(0);

  page.once("dialog", (nativeDialog) => nativeDialog.accept());
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(link).toHaveCount(0);
  await expect(dialog.getByText("Aucun justificatif pour cette opération.")).toBeVisible();
});
