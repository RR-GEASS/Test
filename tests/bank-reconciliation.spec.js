import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { openView } from "./navigation.js";

const top = page => page.locator("dialog[open]").last();
const isoDate = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const bankDate = date => date.split("-").reverse().join("/");
const transaction = (id, label, amountCents, { type = "income", date = isoDate() } = {}) => ({
  id, label, normalizedLabel: false, propertyId: "", date, dueDate: date,
  type, status: "paid", category: type === "income" ? "other_income" : "insurance",
  amountCents, counterparty: "Tiers du relevé", reference: "", notes: "",
  payments: [{ id: `payment-${id}`, date, amountCents, rentCents: 0, chargesCents: 0 }],
});
async function register(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  const dialog = top(page);
  await dialog.getByLabel("Nom de votre SCI").fill("SCI rapprochement");
  await dialog.getByLabel("Adresse e-mail").fill(`bank-flow-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await dialog.getByLabel("Mot de passe").fill("bank-flow-browser-password-2026");
  await dialog.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
async function savedState(page) {
  return page.evaluate(async () => (await (await fetch("/api/session")).json()).state);
}
async function seed(page, transactions) {
  await page.evaluate(async transactions => {
    const session = await (await fetch("/api/session")).json();
    const state = { ...session.state, transactions };
    const response = await fetch("/api/test-fixtures/state", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, revision: session.revision, accountId: session.user.id }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, transactions);
  await page.reload();
}
async function openImport(page, text, name = "compte-sci.csv") {
  await page.locator("#page-content").getByRole("button", { name: "Importer un CSV", exact: true }).first().click();
  const dialog = top(page);
  await dialog.getByLabel("Fichier CSV bancaire", { exact: true }).setInputFiles({
    name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8"),
  });
  return dialog;
}
async function importCSV(page, text, name) {
  const dialog = await openImport(page, text, name);
  await expect(dialog.getByRole("button", { name: "Importer les lignes", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Importer les lignes", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
function bankRow(page, label) {
  return page.getByTestId("bank-line-row").filter({ hasText: label });
}
async function openMatch(page, label) {
  await bankRow(page, label).getByRole("button", { name: "Rapprocher", exact: true }).click();
  await expect(top(page).getByRole("heading", { name: "Rapprocher un mouvement bancaire", exact: true })).toBeVisible();
  return top(page);
}
function candidate(dialog, label) {
  return dialog.getByTestId("bank-candidate-row").filter({ hasText: label });
}
async function validateMatch(page, dialog) {
  await dialog.getByRole("button", { name: "Valider le rapprochement", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
function unzipEntries(bytes) {
  let directory = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { directory = offset; break; }
  }
  expect(directory).toBeGreaterThanOrEqual(0);
  let cursor = bytes.readUInt32LE(directory + 16);
  const count = bytes.readUInt16LE(directory + 10), entries = new Map();
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10), size = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42), name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const dataOffset = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(dataOffset, dataOffset + size);
    entries.set(name, method === 0 ? compressed : inflateRawSync(compressed));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("l’import lit les colonnes françaises et écarte un réimport sans créer de règlement", async ({ page }) => {
  await register(page);
  await seed(page, [transaction("rent", "Règlement déjà saisi", 75000)]);
  const before = await savedState(page);
  await openView(page, "bank-reconciliation");
  const csv = `Compte SCI\nDate opération;Date de valeur;Libellé;Débit;Crédit;Référence\n${bankDate(isoDate())};${bankDate(isoDate())};VIREMENT LOYER;;750,00;BANK-LOYER\n${bankDate(isoDate())};${bankDate(isoDate())};PRLV ASSURANCE;32,50;;BANK-ASSURANCE\n`;
  await importCSV(page, csv, "caisse-epargne-exemple.csv");
  await expect(page.getByTestId("bank-line-count")).toHaveText("2");
  await expect(page.getByTestId("bank-unmatched-count")).toHaveText("2");
  const imported = await savedState(page);
  expect(imported.transactions).toEqual(before.transactions);
  expect(imported.bankMatches).toEqual([]);
  expect(imported.bankLines.map(line => line.amountCents).sort((a, b) => a - b)).toEqual([-3250, 75000]);
  await page.reload();
  await openView(page, "bank-reconciliation");
  await expect(page.getByTestId("bank-line-row")).toHaveCount(2);
  const dialog = await openImport(page, csv, "meme-releve.csv");
  await expect(dialog.locator("[data-import-feedback]")).toContainText("2 doublon(s) possible(s)");
  await expect(dialog.getByRole("button", { name: "Importer les lignes", exact: true })).toBeDisabled();
  expect((await savedState(page)).bankLines).toHaveLength(2);
});

test("les propositions ambiguës restent à choisir et le dossier comptable contient le lien bancaire", async ({ page }) => {
  await register(page);
  await seed(page, [
    transaction("receipt-a", "Encaissement A", 7500),
    transaction("receipt-b", "Encaissement B", 7500, { date: isoDate(-2) }),
    transaction("expense", "Dépense même montant", 7500, { type: "expense" }),
  ]);
  const before = await savedState(page);
  await openView(page, "bank-reconciliation");
  await importCSV(page, `Date;Libellé;Montant\n${bankDate(isoDate())};VIREMENT AMBIGU;75,00\n${bankDate(isoDate())};MOUVEMENT À EXPLIQUER;19,00\n`);
  const dialog = await openMatch(page, "VIREMENT AMBIGU");
  await expect(dialog.getByTestId("bank-candidate-row")).toHaveCount(2);
  await expect(dialog.locator("[data-candidate-index]:checked")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Valider le rapprochement", exact: true })).toBeDisabled();
  await expect(dialog).not.toContainText("Dépense même montant");
  await candidate(dialog, "Encaissement A").getByRole("checkbox").check();
  await validateMatch(page, dialog);
  const matched = await savedState(page);
  expect(matched.transactions).toEqual(before.transactions);
  expect(matched.bankMatches).toHaveLength(1);
  expect(matched.bankMatches[0].allocations).toEqual([{ transactionId: "receipt-a", paymentId: "payment-receipt-a", amountCents: 7500 }]);
  await page.reload();
  await openView(page, "bank-reconciliation");
  await expect(page.getByTestId("bank-matched-count")).toHaveText("1");
  await page.locator(".bank-import-history > summary").click();
  await expect(page.getByTestId("bank-import-record").getByRole("button", { name: "Supprimer cet import", exact: true })).toBeDisabled();
  await openView(page, "exports");
  await expect(page.getByLabel("Inclure le rapprochement bancaire", { exact: true })).toBeChecked();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le dossier ZIP", exact: true }).click();
  const files = unzipEntries(await readFile(await (await pending).path()));
  expect(files.has("cap-sci-comptable.xlsx")).toBe(true);
  expect(files.has("rapprochement-bancaire.csv")).toBe(true);
  expect(files.get("rapprochement-bancaire.csv").toString("utf8")).toContain("VIREMENT AMBIGU");
  expect(files.get("rapprochement-bancaire.csv").toString("utf8")).toContain("Encaissement A");
  expect(files.get("rapprochement-bancaire.csv").toString("utf8")).toContain("MOUVEMENT À EXPLIQUER");
  await openView(page, "bank-reconciliation");
  await bankRow(page, "VIREMENT AMBIGU").getByRole("button", { name: "Voir le rapprochement", exact: true }).click();
  await top(page).getByRole("button", { name: "Défaire le rapprochement", exact: true }).click();
  await top(page).getByRole("button", { name: "Défaire le rapprochement", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect((await savedState(page)).bankMatches).toEqual([]);
  expect((await savedState(page)).transactions).toEqual(before.transactions);
  if (!await page.locator(".bank-import-history").evaluate(element => element.open)) await page.locator(".bank-import-history > summary").click();
  await page.getByTestId("bank-import-record").getByRole("button", { name: "Supprimer cet import", exact: true }).click();
  await top(page).getByRole("button", { name: "Supprimer l’import", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect((await savedState(page)).bankLines).toEqual([]);
  expect((await savedState(page)).transactions).toEqual(before.transactions);
});

test("un versement groupé et plusieurs virements pour un règlement gardent leur ventilation exacte", async ({ page }) => {
  await register(page);
  await seed(page, [transaction("first", "Première échéance", 6000), transaction("second", "Deuxième échéance", 4000), transaction("split", "Règlement fractionné", 10000)]);
  const before = await savedState(page);
  await openView(page, "bank-reconciliation");
  await importCSV(page, `Date;Libellé;Montant\n${bankDate(isoDate())};VERSEMENT GROUPÉ;100,00\n${bankDate(isoDate())};VIREMENT PARTIE 1;30,00\n${bankDate(isoDate())};VIREMENT PARTIE 2;70,00\n`);
  let dialog = await openMatch(page, "VERSEMENT GROUPÉ");
  await dialog.getByLabel("Afficher tous les règlements disponibles du même sens", { exact: true }).check();
  await candidate(dialog, "Première échéance").getByRole("checkbox").check();
  await expect(dialog.getByRole("button", { name: "Valider le rapprochement", exact: true })).toBeDisabled();
  await candidate(dialog, "Deuxième échéance").getByRole("checkbox").check();
  await validateMatch(page, dialog);
  dialog = await openMatch(page, "VIREMENT PARTIE 1");
  await dialog.getByLabel("Afficher tous les règlements disponibles du même sens", { exact: true }).check();
  await candidate(dialog, "Règlement fractionné").getByRole("checkbox").check();
  await expect(candidate(dialog, "Règlement fractionné").locator("[data-candidate-amount]")).toHaveValue("30,00");
  await validateMatch(page, dialog);
  dialog = await openMatch(page, "VIREMENT PARTIE 2");
  await expect(dialog.getByTestId("bank-candidate-row")).toHaveCount(1);
  await candidate(dialog, "Règlement fractionné").getByRole("checkbox").check();
  await validateMatch(page, dialog);
  const saved = await savedState(page);
  expect(saved.transactions).toEqual(before.transactions);
  expect(saved.bankMatches).toHaveLength(3);
  expect(saved.bankMatches.flatMap(match => match.allocations).filter(allocation => allocation.transactionId === "split").map(allocation => allocation.amountCents).sort((a, b) => a - b)).toEqual([3000, 7000]);
  await expect(page.getByTestId("bank-matched-count")).toHaveText("3");
});

test("un montant invalide bloque l’import et le choix manuel des colonnes fonctionne sur téléphone", async ({ page }) => {
  await register(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openView(page, "bank-reconciliation");
  const dialog = await openImport(page, `Date;Libellé;Montant\n${bankDate(isoDate())};MONTANT INVALIDE;12,345\n`);
  await expect(dialog.locator("[data-import-errors]")).toContainText(/montant/i);
  await expect(dialog.getByRole("button", { name: "Importer les lignes", exact: true })).toBeDisabled();
  expect((await savedState(page)).bankLines).toHaveLength(0);
  await dialog.getByLabel("Fichier CSV bancaire", { exact: true }).setInputFiles({
    name: "colonnes-personnelles.csv", mimeType: "text/csv",
    buffer: Buffer.from(`Jour;Objet;Entrée;Sortie\n${bankDate(isoDate())};COLONNES CHOISIES;120,50;\n`),
  });
  await dialog.locator(".bank-import-options > summary").click();
  if (!await dialog.locator(".bank-import-options").evaluate(element => element.open)) await dialog.locator(".bank-import-options > summary").click();
  await dialog.getByLabel("Ligne des en-têtes", { exact: true }).fill("1");
  await dialog.getByLabel("Ligne des en-têtes", { exact: true }).press("Tab");
  await dialog.getByLabel("Présentation des montants", { exact: true }).selectOption("split");
  await dialog.getByLabel("Date de l’opération", { exact: true }).selectOption("0");
  await dialog.getByLabel("Libellé bancaire", { exact: true }).selectOption("1");
  await dialog.getByLabel("Débit", { exact: true }).selectOption("3");
  await dialog.getByLabel("Crédit", { exact: true }).selectOption("2");
  await expect(dialog.getByTestId("bank-import-preview-row")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Importer les lignes", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Importer les lignes", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByTestId("bank-line-count")).toHaveText("1");
  expect((await savedState(page)).bankLines[0].amountCents).toBe(12050);
  expect((await savedState(page)).transactions).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
