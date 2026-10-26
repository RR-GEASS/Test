import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const monthStart = (offset = 0) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
};
async function navigate(page, name) {
  const button = page.locator("aside nav").getByRole("button", { name, exact: true });
  if (!(await button.isVisible())) await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await button.click();
}
async function saved(page) {
  await expect(page.getByText("Enregistré en ligne", { exact: true })).toBeVisible();
}
async function session(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error(`Session HTTP ${response.status}`);
    return (await response.json()).state;
  });
}
async function register(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de votre SCI").fill("SCI des prêts");
  await dialog.getByLabel("Adresse e-mail").fill(`loan-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await dialog.getByLabel("Mot de passe").fill("loan-browser-password-2026");
  await dialog.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
}
async function split(dialog, capital, interest, insurance) {
  await dialog.locator('[name="capital"]').fill(capital);
  await dialog.locator('[name="interest"]').fill(interest);
  await dialog.locator('[name="insurance"]').fill(insurance);
}
async function downloadCSV(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le CSV des opérations", exact: true }).click();
  return readFile(await (await pending).path(), "utf8");
}
function csvRecords(text) {
  const rows = text.replace(/^\ufeff/, "").split("\r\n").filter(Boolean)
    .map((line) => line.slice(1, -1).split('";"').map((cell) => cell.replace(/""/g, '"')));
  return rows.slice(1).map((row) => Object.fromEntries(rows[0].map((heading, index) => [heading, row[index]])));
}

test("le prêt périodique se corrige par échéance dans le pointage et conserve ses informations comptables", async ({ page }) => {
  await register(page);
  await navigate(page, "Opérations périodiques");
  await page.getByRole("button", { name: "Nouvelle périodicité", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type", { exact: true }).selectOption("expense");
  await dialog.getByLabel("Catégorie", { exact: true }).selectOption("loan_payment");
  await split(dialog, "750", "220", "30");
  await dialog.locator('[name="counterparty"]').fill("Banque du bien");
  await dialog.locator('[name="reference"]').fill("PRET-123");
  await dialog.locator('[name="notes"]').fill("Tableau bancaire à vérifier");
  await dialog.getByLabel("Date de début *").fill(monthStart(-1));
  await dialog.getByRole("button", { name: "Créer la périodicité", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  const initial = await session(page);
  expect(initial.transactions).toHaveLength(2);
  expect(initial.recurrences[0]).toMatchObject({ amountCents: 100000, capitalCents: 75000, interestCents: 22000, insuranceCents: 3000 });
  for (const transaction of initial.transactions)
    expect(transaction).toMatchObject({ counterparty: "Banque du bien", reference: "PRET-123", notes: "Tableau bancaire à vérifier" });

  await navigate(page, "Pointage mensuel");
  const row = page.getByTestId("pointing-row");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Ajuster le prêt", exact: true }).click();
  await split(dialog, "760", "210", "35");
  await dialog.getByRole("button", { name: "Enregistrer la répartition", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  const adjusted = await session(page);
  const current = adjusted.transactions.find((t) => t.occurrenceDate === monthStart());
  expect(current).toMatchObject({ amountCents: 100500, capitalCents: 76000, interestCents: 21000, insuranceCents: 3500 });
  expect(adjusted.transactions.find((t) => t.id !== current.id)).toEqual(initial.transactions.find((t) => t.id !== current.id));
  expect(adjusted.recurrences).toEqual(initial.recurrences);

  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Valider les règlements", exact: true }).click();
  await dialog.getByRole("button", { name: "Valider les règlements", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  await row.getByRole("button", { name: "Ajuster le prêt", exact: true }).click();
  await split(dialog, "765", "205", "35");
  await dialog.getByRole("button", { name: "Enregistrer la répartition", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  await row.getByRole("button", { name: "Ajuster le prêt", exact: true }).click();
  await split(dialog, "800", "205", "35");
  await dialog.getByRole("button", { name: "Enregistrer la répartition", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/montant|ventilation|règlement/i);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.reload();
  const final = (await session(page)).transactions.find((t) => t.id === current.id);
  expect(final).toMatchObject({ amountCents: 100500, capitalCents: 76500, interestCents: 20500, insuranceCents: 3500, status: "paid" });
  expect(final.payments).toHaveLength(1);
  expect(final.payments[0].amountCents).toBe(100500);

  await navigate(page, "Export comptable");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le CSV des opérations", exact: true }).click();
  const csv = await readFile(await (await pending).path(), "utf8");
  expect(csv).toContain("Capital de prêt attendu EUR");
  expect(csv).toContain('"765,00";"205,00";"35,00"');
  expect(csv).toContain("Banque du bien");
  expect(csv).toContain("PRET-123");
  expect(csv).toContain("Tableau bancaire à vérifier");
});

test("un prêt ponctuel calcule son total et garde la saisie après un clic hors de la fenêtre", async ({ page }) => {
  await register(page);
  await navigate(page, "Opérations");
  await page.getByRole("button", { name: "Nouvelle opération", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type", { exact: true }).selectOption("expense");
  await dialog.getByLabel("Catégorie", { exact: true }).selectOption("loan_payment");
  await split(dialog, "500,25", "100,75", "20");
  await dialog.locator('[name="counterparty"]').fill("Banque ponctuelle");
  await dialog.locator('[name="reference"]').fill("REF-456");
  await dialog.locator('[name="notes"]').fill("Échéance exceptionnelle");
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[name="capital"]')).toHaveValue("500,25");
  await expect(dialog.locator('[name="reference"]')).toHaveValue("REF-456");
  await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  expect((await session(page)).transactions[0]).toMatchObject({ category: "loan_payment", amountCents: 62100, capitalCents: 50025, interestCents: 10075, insuranceCents: 2000, counterparty: "Banque ponctuelle", reference: "REF-456", notes: "Échéance exceptionnelle" });
  const row = page.getByTestId("operation-row");
  await expect(row.locator("[data-document-status]")).toHaveText("Justificatif manquant");
  await row.getByRole("button", { name: /^Actions pour / }).click();
  await page.getByRole("menuitem", { name: "Justificatifs", exact: true }).click();
  await dialog.getByLabel("Ajouter un justificatif", { exact: true }).setInputFiles({
    name: "echeance.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await expect(dialog.getByRole("link")).toHaveCount(1);
  await dialog.locator(".dialog-footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(row.locator("[data-document-status]")).toHaveText("1 justificatif");
  await navigate(page, "Export comptable");
  await page.getByLabel("Dates à utiliser", { exact: true }).selectOption("due");
  const exported = csvRecords(await downloadCSV(page));
  expect(exported).toHaveLength(1);
  expect(exported[0]["Nombre de justificatifs enregistrés"]).toBe("1");
  expect(exported[0]["Justificatif manquant"]).toBe("Non");
  await navigate(page, "Opérations");
  await row.getByRole("button", { name: /^Actions pour / }).click();
  await page.getByRole("menuitem", { name: "Justificatifs", exact: true }).click();
  page.once("dialog", (nativeDialog) => nativeDialog.accept());
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await dialog.locator(".dialog-footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(row.locator("[data-document-status]")).toHaveText("Justificatif manquant");
  await page.getByRole("button", { name: "Nouvelle opération", exact: true }).click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("le CSV de démonstration laisse le statut des justificatifs inconnu", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Export comptable");
  const exported = csvRecords(await downloadCSV(page));
  expect(exported.length).toBeGreaterThan(0);
  for (const row of exported) {
    expect(row["Nombre de justificatifs enregistrés"]).toBe("");
    expect(row["Justificatif manquant"]).toBe("");
  }
});

test("les formulaires de prêt et le pointage restent utilisables sur mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  await navigate(page, "Opérations");
  await page.getByRole("button", { name: "Nouvelle opération", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type", { exact: true }).selectOption("expense");
  await dialog.getByLabel("Catégorie", { exact: true }).selectOption("loan_payment");
  await split(dialog, "750", "220", "30");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate((node) => node.getBoundingClientRect().width <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".artifacts/loan-mobile-form.png", fullPage: true });
  await dialog.getByRole("button", { name: "Ajouter l’opération", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  await navigate(page, "Pointage mensuel");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Ajuster le prêt", exact: true }).click();
  await split(dialog, "760", "210", "30");
  await page.screenshot({ path: ".artifacts/loan-mobile-pointing.png", fullPage: true });
  await dialog.getByRole("button", { name: "Enregistrer la répartition", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  expect((await session(page)).transactions[0]).toMatchObject({ capitalCents: 76000, interestCents: 21000, insuranceCents: 3000, amountCents: 100000 });
});
