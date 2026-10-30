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


test("le dossier annuel remet les filtres à zéro et inclut les non-réglées ainsi que les règlements d’années antérieures", async ({ page }) => {
  await page.goto("/");
  const year = new Date().getFullYear();
  await page.evaluate(async year => {
    const registration = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `annual-${crypto.randomUUID()}@example.test`, password: "annual-browser-password-2026", name: "SCI annuelle" }) });
    if (!registration.ok) throw new Error(await registration.text());
    const account = await registration.json();
    const base = { type: "expense", category: "insurance", status: "pending", propertyId: "", amountCents: 10000, rentCents: 0, chargesCents: 0, counterparty: "Assureur", reference: "", notes: "" };
    account.state.transactions = [
      { ...base, id: "unpaid-current", label: "Facture de décembre non réglée", date: `${year}-12-10`, dueDate: `${year}-12-10`, period: `${year}-12`, payments: [] },
      { ...base, id: "prior-paid", label: "Dette ancienne payée cette année", status: "paid", date: `${year-1}-12-10`, dueDate: `${year-1}-12-10`, period: `${year-1}-12`, payments: [{ id: "settled-now", date: `${year}-01-15`, amountCents: 10000, rentCents: 0, chargesCents: 0 }] },
      { ...base, id: "cancelled", label: "Facture annulée", status: "paid", date: `${year}-01-10`, dueDate: `${year}-01-10`, period: `${year}-01`, cancelledAt: `${year}-01-20`, cancellationReason: "Doublon", payments: [{ id: "old-settlement", date: `${year}-01-15`, amountCents: 10000, rentCents: 0, chargesCents: 0 }] },
    ];
    const saved = await fetch("/api/test-fixtures/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: account.state, revision: account.revision, accountId: account.user.id }) });
    if (!saved.ok) throw new Error(await saved.text());
  }, year);
  await page.reload();
  await exportsPage(page);
  await page.getByRole("button", { name: "Année en cours", exact: true }).click();
  await page.getByLabel("Réglées", { exact: true }).check();
  await page.getByLabel("Tout inclure", { exact: true }).uncheck();
  await expect(page.getByTestId("export-operation-count")).toHaveText("0");
  await page.getByRole("button", { name: "Dossier annuel comptable", exact: true }).click();
  await expect(page.getByLabel("Dates à utiliser", { exact: true })).toHaveValue("annual");
  await expect(page.getByLabel("Réglées", { exact: true })).not.toBeChecked();
  await expect(page.getByTestId("export-operation-count")).toHaveText("2");
  await expect(page.getByTestId("export-operation-row").filter({ hasText: "Facture de décembre non réglée" })).toHaveCount(1);
  await expect(page.getByTestId("export-operation-row").filter({ hasText: "Dette ancienne payée cette année" })).toHaveCount(1);
  await expect(page.getByLabel("Inclure les justificatifs", { exact: true })).toBeChecked();
  await page.getByText("Historique des annulations", { exact: true }).click();
  await page.getByLabel("Inclure les opérations annulées", { exact: true }).check();
  await expect(page.getByTestId("export-operation-count")).toHaveText("3");
  await expect(page.getByTestId("export-payment-count")).toHaveText("1");
  await expect(page.getByTestId("export-operation-row").filter({ hasText: "Facture annulée" })).toContainText("Annulée");
});
