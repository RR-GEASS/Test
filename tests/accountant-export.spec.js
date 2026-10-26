import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const password = "accountant-browser-password-2026";
const year = new Date().getFullYear();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
const operationRow = (page, detail) =>
  page.getByTestId("operation-row").filter({ hasText: detail });

async function navigate(page, name) {
  const button = page
    .locator("aside nav")
    .getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await button.click();
}
async function saved(page) {
  await expect(
    page.getByText("Enregistré en ligne", { exact: true }),
  ).toBeVisible();
}
async function register(page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de votre SCI").fill("SCI Export Tests");
  await dialog
    .getByLabel("Adresse e-mail")
    .fill(
      `export-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    );
  await dialog.getByLabel("Mot de passe").fill(password);
  await dialog
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
}
async function addOperation(
  page,
  detail,
  {
    date = `${year}-01-10`,
    amount = "125,40",
    type = "income",
    status = "paid",
  } = {},
) {
  await page
    .getByRole("button", { name: "Nouvelle opération", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type", { exact: true }).selectOption(type);
  await dialog
    .getByLabel("Catégorie", { exact: true })
    .selectOption(type === "income" ? "other_income" : "other_expense");
  await dialog.getByLabel("Détail (facultatif)").fill(detail);
  await dialog.getByLabel("Montant (€) *").fill(amount);
  await dialog.getByLabel("Date / échéance *").fill(date);
  await dialog.getByLabel("Période concernée").fill(date.slice(0, 7));
  await dialog.getByLabel("Statut", { exact: true }).selectOption(status);
  await dialog
    .getByRole("button", { name: "Ajouter l’opération", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
}
async function openDocuments(page, detail) {
  await navigate(page, "Opérations");
  await operationRow(page, detail)
    .locator('[data-action="operation-menu"]')
    .click();
  await page
    .getByRole("menuitem", { name: "Justificatifs", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByLabel("Ajouter un justificatif", { exact: true }),
  ).toBeVisible();
  return page.getByRole("dialog");
}
async function uploadPDF(dialog, filename) {
  const before = await dialog.getByRole("link").count();
  await dialog
    .getByLabel("Ajouter un justificatif", { exact: true })
    .setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: pdf,
    });
  await expect(dialog.getByRole("link")).toHaveCount(before + 1);
}
function unzipEntries(bytes) {
  let eocd = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0)
    throw new Error("Le téléchargement ne contient pas un ZIP valide.");
  const entries = new Map();
  let central = bytes.readUInt32LE(eocd + 16);
  const count = bytes.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(central) !== 0x02014b50)
      throw new Error("Répertoire ZIP invalide.");
    const method = bytes.readUInt16LE(central + 10);
    const compressedSize = bytes.readUInt32LE(central + 20);
    const nameLength = bytes.readUInt16LE(central + 28);
    const extraLength = bytes.readUInt16LE(central + 30);
    const commentLength = bytes.readUInt16LE(central + 32);
    const name = bytes
      .subarray(central + 46, central + 46 + nameLength)
      .toString("utf8");
    const local = bytes.readUInt32LE(central + 42);
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + compressedSize);
    entries.set(
      name,
      method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? inflateRawSync(compressed)
          : (() => {
              throw new Error(`Compression ZIP non reconnue : ${method}`);
            })(),
    );
    central += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
async function openExport(
  page,
  start = `${year}-01-01`,
  end = `${year}-12-31`,
) {
  await navigate(page, "Export comptable");
  await expect(
    page.getByRole("heading", { name: "Export comptable." }),
  ).toBeVisible();
  await page.getByLabel("Du", { exact: true }).fill(start);
  await page.getByLabel("Au", { exact: true }).fill(end);
}

test("le dossier comptable contient les CSV et les justificatifs renommés, avec les octets d’origine", async ({
  page,
}) => {
  await register(page);
  await addOperation(page, "Recette à transmettre");
  const dialog = await openDocuments(page, "Recette à transmettre");
  await uploadPDF(dialog, "nom-prive-original.pdf");
  const renamed = await dialog.getByRole("link").first().innerText();
  expect(renamed).toMatch(/\.pdf$/i);
  expect(renamed).toContain("Recette à transmettre");
  expect(renamed).not.toBe("nom-prive-original.pdf");
  await dialog
    .locator(".dialog-footer")
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  await openExport(page, `${year}-01-10`, `${year}-01-10`);
  await expect(page.getByTestId("export-operation-row")).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", {
      name: "Inclure les justificatifs",
      exact: true,
    }),
  ).toBeChecked();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le dossier ZIP", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.zip$/i);
  const entries = unzipEntries(await readFile(await download.path()));
  for (const name of [
    "operations.csv",
    "reglements.csv",
    "biens.csv",
    "parametres-sci.json",
    "manifest.json",
    "README.txt",
  ])
    expect(entries.has(name)).toBe(true);
  expect(entries.get("operations.csv").toString("utf8")).toContain(
    "Recette à transmettre",
  );
  expect(entries.get("reglements.csv").toString("utf8")).toContain("125,40");
  const documentEntry = [...entries.entries()].find(
    ([name]) => name.startsWith("justifs/") && name.endsWith(".pdf"),
  );
  expect(documentEntry).toBeDefined();
  expect(documentEntry[0]).toContain("Recette à transmettre");
  expect(documentEntry[1]).toEqual(pdf);
  expect(
    [...entries.keys()].some(
      (name) => name.includes("..") || name.startsWith("/"),
    ),
  ).toBe(false);
});

test("les dates sont inclusives et les bases de dates, types et statuts précisent la sélection", async ({
  page,
}) => {
  await register(page);
  await addOperation(page, "Encaissement du dix", {
    date: `${year}-01-10`,
    amount: "100,10",
  });
  await addOperation(page, "Encaissement du onze", {
    date: `${year}-01-11`,
    amount: "200,20",
  });
  await addOperation(page, "Échéance non réglée", {
    date: `${year}-01-10`,
    amount: "300,30",
    status: "pending",
  });
  await addOperation(page, "Dépense du dix", {
    date: `${year}-01-10`,
    amount: "50,00",
    type: "expense",
  });
  await openExport(page, `${year}-01-10`, `${year}-01-10`);
  await expect(page.getByTestId("export-operation-row")).toHaveCount(2);
  await expect(
    page
      .getByTestId("export-operation-row")
      .filter({ hasText: "Encaissement du dix" }),
  ).toHaveCount(1);
  await expect(
    page
      .getByTestId("export-operation-row")
      .filter({ hasText: "Encaissement du onze" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("export-operation-row")
      .filter({ hasText: "Échéance non réglée" }),
  ).toHaveCount(0);
  await page
    .getByRole("group", { name: "Types", exact: true })
    .getByRole("checkbox", { name: "Encaissements", exact: true })
    .check();
  await expect(page.getByTestId("export-operation-row")).toHaveCount(1);
  await page
    .getByRole("group", { name: "Types", exact: true })
    .getByRole("checkbox", { name: "Encaissements", exact: true })
    .uncheck();
  await page
    .getByLabel("Dates à utiliser", { exact: true })
    .selectOption("due");
  await expect(page.getByTestId("export-operation-row")).toHaveCount(3);
  await page
    .getByRole("group", { name: "Statuts", exact: true })
    .getByRole("checkbox", { name: "Réglées", exact: true })
    .check();
  await expect(page.getByTestId("export-operation-row")).toHaveCount(2);
  await page.getByLabel("Au", { exact: true }).fill(`${year}-01-09`);
  await expect(
    page.getByRole("button", {
      name: "Télécharger le dossier ZIP",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).not.toBeEmpty();
});

test("les documents d’une même opération restent distincts et suivent un changement de libellé", async ({
  page,
}) => {
  await register(page);
  await addOperation(page, "Ancien détail de facture");
  let dialog = await openDocuments(page, "Ancien détail de facture");
  await uploadPDF(dialog, "premier.pdf");
  await uploadPDF(dialog, "deuxieme.pdf");
  const names = await dialog.getByRole("link").allInnerTexts();
  expect(new Set(names).size).toBe(2);
  expect(
    names.every(
      (name) =>
        name.includes("Ancien détail de facture") && name.endsWith(".pdf"),
    ),
  ).toBe(true);
  expect(names.some((name) => /\(2\)\.pdf$/.test(name))).toBe(true);
  const pending = page.waitForEvent("download");
  await dialog.getByRole("link").first().click();
  expect(await readFile(await (await pending).path())).toEqual(pdf);
  await dialog
    .locator(".dialog-footer")
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  await operationRow(page, "Ancien détail de facture")
    .locator('[data-action="operation-menu"]')
    .click();
  await page.getByRole("menuitem", { name: "Modifier", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Détail (facultatif)")
    .fill("Nouveau détail de facture");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await saved(page);
  dialog = await openDocuments(page, "Nouveau détail de facture");
  await expect(dialog.getByRole("link")).toHaveCount(2);
  const updated = await dialog.getByRole("link").allInnerTexts();
  expect(
    updated.every((name) => name.includes("Nouveau détail de facture")),
  ).toBe(true);
  expect(
    updated.some((name) => name.includes("Ancien détail de facture")),
  ).toBe(false);
});

test("l’export reste utilisable sur téléphone sans débordement global", async ({
  page,
}) => {
  await register(page);
  await addOperation(page, "Recette mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await openExport(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", {
      name: "Télécharger le dossier ZIP",
      exact: true,
    }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le dossier ZIP", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toMatch(/\.zip$/i);
});

test("la sélection manuelle exclut réellement une opération du dossier et permet de tout désélectionner", async ({
  page,
}) => {
  await register(page);
  await addOperation(page, "Ligne à transmettre");
  await addOperation(page, "Ligne à conserver privée");
  await openExport(page);
  await expect(page.getByTestId("export-operation-count")).toHaveText("2");
  await page
    .getByTestId("export-operation-row")
    .filter({ hasText: "Ligne à conserver privée" })
    .getByRole("checkbox")
    .uncheck();
  await expect(page.getByTestId("export-operation-count")).toHaveText("1");
  await page
    .getByRole("checkbox", { name: "Inclure les justificatifs", exact: true })
    .uncheck();
  await expect(page.getByTestId("export-operation-count")).toHaveText("1");
  await page
    .getByRole("checkbox", {
      name: "Inclure tous les règlements liés",
      exact: true,
    })
    .check();
  await expect(page.getByTestId("export-operation-count")).toHaveText("1");
  await page
    .getByRole("checkbox", {
      name: "Inclure tous les règlements liés",
      exact: true,
    })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Inclure les justificatifs", exact: true })
    .check();
  await expect(
    page
      .getByTestId("export-operation-row")
      .filter({ hasText: "Ligne à conserver privée" })
      .getByRole("checkbox"),
  ).not.toBeChecked();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le dossier ZIP", exact: true })
    .click();
  const entries = unzipEntries(await readFile(await (await pending).path()));
  const csv = entries.get("operations.csv").toString("utf8");
  expect(csv).toContain("Ligne à transmettre");
  expect(csv).not.toContain("Ligne à conserver privée");
  expect(
    JSON.parse(entries.get("manifest.json").toString("utf8")).operations,
  ).toHaveLength(1);
  await page
    .getByRole("checkbox", { name: "Tout inclure", exact: true })
    .check();
  await expect(page.getByTestId("export-operation-count")).toHaveText("2");
  await page
    .getByRole("checkbox", { name: "Tout inclure", exact: true })
    .uncheck();
  await expect(page.getByTestId("export-operation-count")).toHaveText("0");
  await expect(
    page.getByRole("button", {
      name: "Télécharger le dossier ZIP",
      exact: true,
    }),
  ).toBeDisabled();
});
test("un dossier en cours de téléchargement garde les dates demandées malgré une modification ultérieure du formulaire", async ({
  page,
}) => {
  await register(page);
  await addOperation(page, "Dossier de janvier");
  await openExport(page, `${year}-01-01`, `${year}-01-31`);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let signal;
  const arrived = new Promise((resolve) => (signal = resolve));
  await page.route("**/api/exports/accountant", async (route) => {
    const response = await route.fetch();
    signal();
    await gate;
    await route.fulfill({ response });
  });
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le dossier ZIP", exact: true })
    .click();
  await arrived;
  await page.getByLabel("Au", { exact: true }).fill(`${year}-02-28`);
  release();
  const downloaded = await pending;
  expect(downloaded.suggestedFilename()).toBe(
    `cap-sci-comptable-${year}-01-01-${year}-01-31.zip`,
  );
  const files = unzipEntries(await readFile(await downloaded.path()));
  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  expect(manifest.filters.endDate).toBe(`${year}-01-31`);
});
