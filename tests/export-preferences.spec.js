import { test, expect } from "@playwright/test";

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
async function exportsPage(page) {
  await page.locator("aside nav").getByRole("button", { name: "Export comptable", exact: true }).click();
}

test("les raccourcis calendaires et préférences de l’export persistent sans mémoriser une sélection de lignes", async ({ page }) => {
  await page.goto("/");
  await exportsPage(page);
  const now = new Date();
  await page.getByRole("button", { name: "Mois précédent", exact: true }).click();
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue(localDate(new Date(now.getFullYear(), now.getMonth(), 0)));
  await page.getByRole("button", { name: "Trimestre précédent", exact: true }).click();
  const quarterStart = Math.floor(now.getMonth() / 3) * 3;
  const expectedStart = localDate(new Date(now.getFullYear(), quarterStart - 3, 1));
  const expectedEnd = localDate(new Date(now.getFullYear(), quarterStart, 0));
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(expectedStart);
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue(expectedEnd);
  await page.getByLabel("Dates à utiliser", { exact: true }).selectOption("due");
  await page.getByLabel("Inclure les justificatifs", { exact: true }).uncheck();
  await page.getByLabel("Inclure les baux et avenants liés", { exact: true }).check();
  await page.getByLabel("Tout inclure", { exact: true }).uncheck();
  await page.reload();
  await exportsPage(page);
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(expectedStart);
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue(expectedEnd);
  await expect(page.getByLabel("Dates à utiliser", { exact: true })).toHaveValue("due");
  await expect(page.getByLabel("Inclure les justificatifs", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Inclure les baux et avenants liés", { exact: true })).toBeChecked();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cap-sci.export.demo")));
  expect(stored).not.toHaveProperty("operationIds");
});

test("le contrôle avant export utilise les pièces du compte et respecte les dispenses", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const response = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `export-controls-${crypto.randomUUID()}@example.test`, password: "export-controls-password-2026", name: "SCI contrôle" }) });
    if (!response.ok) throw new Error(await response.text());
    const session = await response.json();
    const date = new Date().toLocaleDateString("sv-SE");
    const base = { date, dueDate: date, type: "expense", category: "insurance", status: "pending", propertyId: "", amountCents: 1000, counterparty: "Assureur", label: "Assurance", reference: "", notes: "", payments: [] };
    session.state.transactions = [
      { ...base, id: "with-doc", reference: "FACT-1" },
      { ...base, id: "missing-doc" },
      { ...base, id: "exempt", documentNotRequired: true },
    ];
    const saved = await fetch("/api/test-fixtures/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: session.state, revision: session.revision, accountId: session.user.id }) });
    if (!saved.ok) throw new Error(await saved.text());
    const uploaded = await fetch("/api/transactions/with-doc/attachments", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": "facture.pdf" }, body: new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF") });
    if (!uploaded.ok) throw new Error(await uploaded.text());
  });
  await page.reload();
  await exportsPage(page);
  await page.getByLabel("Dates à utiliser", { exact: true }).selectOption("due");
  await expect(page.locator("#export-preflight")).toContainText("1 opération(s) sans justificatif");
  await expect(page.locator("#export-preflight")).toContainText("1 sans pièce requise");
  await expect(page.locator("#export-preflight")).toContainText("2 référence(s) non renseignée(s)");
  await expect(page.getByLabel("Inclure les baux et avenants liés", { exact: true })).not.toBeChecked();
});
