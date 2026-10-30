import { revealNav } from "./navigation.js";
import { test, expect } from "@playwright/test";

async function register(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de votre SCI").fill("SCI des fiches");
  await dialog.getByLabel("Adresse e-mail").fill(`directory-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await dialog.getByLabel("Mot de passe").fill("directory-browser-password-2026");
  await dialog.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await saved(page);
}
async function saved(page) {
  await expect(page.getByText("Enregistré en ligne", { exact: true })).toBeVisible();
}
async function go(page, view) {
  const item = page.locator(`aside nav [data-view="${view}"]`);
  await revealNav(page,item);
  if (!(await item.isVisible())) await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await item.click();
}
async function state(page) {
  return page.evaluate(async () => (await (await fetch("/api/session")).json()).state);
}
const top = (page) => page.locator("dialog[open]").last();
async function tenant(page, name) {
  await go(page, "tenants");
  await page.locator('[data-action="add-tenant"]').click();
  await top(page).getByLabel("Nom et prénom / raison sociale *").fill(name);
  await top(page).getByLabel("E-mail", { exact: true }).fill("locataire@example.test");
  await top(page).getByRole("button", { name: "Créer le locataire", exact: true }).click();
  await saved(page);
}
async function property(page) {
  await go(page, "properties");
  await page.locator('.page-heading [data-action="add-property"]').click();
  await top(page).getByLabel("Nom court du bien *").fill("Tilleuls T2");
  await top(page).locator('[name=address]').fill('Rue des Tilleuls');
  await top(page).getByLabel("Loyer mensuel hors charges (€)").fill("800");
  await top(page).getByLabel("Provisions mensuelles (€)").fill("50");
  await top(page).getByRole("button", { name: "Ajouter le bien", exact: true }).click();
  await saved(page);
}
async function lease(page, name, start, end = "") {
  await go(page, "leases");
  await page.locator('[data-action="add-lease"]').click();
  await top(page).getByLabel("Locataire *", { exact: true }).selectOption({ label: name });
  await top(page).getByLabel("Bien *", { exact: true }).selectOption({ label: "Tilleuls T2" });
  await top(page).getByLabel("Date d’entrée *").fill(start);
  if (end) await top(page).getByLabel("Date de sortie").fill(end);
  await top(page).getByLabel("Dépôt de garantie prévu (€)").fill("800");
  await top(page).getByRole("button", { name: "Créer la location", exact: true }).click();
  await saved(page);
}

test("les fournisseurs gardent leurs coordonnées et une désactivation conserve leur fiche", async ({ page }) => {
  await register(page);
  await go(page, "suppliers");
  await page.locator('[data-action="add-supplier"]').click();
  await top(page).getByLabel("Nom court *", { exact: true }).fill("Assureur Tilleuls");
  await top(page).getByLabel("Raison sociale").fill("Assureur Tilleuls SAS");
  await top(page).getByLabel("Catégorie habituelle").selectOption("insurance");
  await top(page).getByLabel("Référence client ou contrat").fill("CLIENT-42");
  await top(page).getByLabel("E-mail", { exact: true }).fill("assureur@example.test");
  await top(page).getByRole("button", { name: "Créer le fournisseur", exact: true }).click();
  await saved(page);
  await page.reload();
  await go(page, "suppliers");
  const card = page.getByTestId("supplier-card");
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: /Ouvrir la fiche/ }).click();
  await expect(top(page)).toContainText("CLIENT-42");
  await expect(top(page)).toContainText("Assureur Tilleuls SAS");
  await top(page).getByRole("button", { name: "Désactiver la fiche", exact: true }).click();
  await top(page).getByRole("button", { name: "Désactiver", exact: true }).click();
  await saved(page);
  await expect(card).toHaveCount(0);
  await page.getByLabel("Afficher les fiches désactivées").check();
  await expect(card).toHaveCount(1);
  expect((await state(page)).suppliers[0]).toMatchObject({ name: "Assureur Tilleuls", category: "insurance", reference: "CLIENT-42", archived: true });
});

test("un changement de locataire conserve les anciennes locations et le bail reste attaché au bon bien", async ({ page }) => {
  await register(page);
  await property(page);
  await tenant(page, "Camille Martin");
  await tenant(page, "Alex Bernard");
  await lease(page, "Camille Martin", "2025-01-01", "2025-12-31");
  await lease(page, "Alex Bernard", "2026-01-01");
  await expect(page.getByTestId("lease-card")).toHaveCount(2);
  const oldCard = page.getByTestId("lease-card").filter({ hasText: "Camille Martin" });
  await oldCard.getByRole("button", { name: /Ouvrir la location/ }).click();
  await top(page).getByRole("button", { name: "Bail et documents", exact: true }).click();
  await top(page).getByLabel("Type de document").selectOption("bail");
  await top(page).getByLabel("Ajouter des documents").setInputFiles({ name: "bail-camille.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF") });
  await expect(top(page).getByRole("link")).toHaveCount(1);
  await top(page).locator(".dialog-footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await top(page).locator(".dialog-footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByTestId("lease-card").filter({ hasText: "Alex Bernard" }).getByRole("button", { name: /Ouvrir la location/ }).click();
  await top(page).getByRole("button", { name: "Bail et documents", exact: true }).click();
  await expect(top(page).getByText("Aucun document pour cette fiche.")).toBeVisible();
  await top(page).locator(".dialog-footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await top(page).locator(".dialog-footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await page.reload();
  expect((await state(page)).leases).toHaveLength(2);
  await go(page, "tenants");
  await page.getByTestId("tenant-card").filter({ hasText: "Camille Martin" }).getByRole("button", { name: /Ouvrir la fiche/ }).click();
  await top(page).getByRole("tab", { name: "Locations", exact: true }).click();
  await expect(top(page).getByTestId("lease-card")).toHaveCount(1);
  await expect(top(page).getByTestId("lease-card")).toContainText("Terminée");
});

test("terminer une location avant la première échéance met sa périodicité en pause sans rendre les dates invalides", async ({ page }) => {
  await register(page);
  await property(page);
  await tenant(page, "Locataire départ anticipé");
  const year = new Date().getFullYear() + 1;
  await lease(page, "Locataire départ anticipé", `${year}-01-01`);
  await page.evaluate(async (year) => {
    const snapshot = await (await fetch("/api/session")).json();
    const lease = snapshot.state.leases[0];
    snapshot.state.recurrences.push({
      id: "future-lease-rule", type: "income", category: "rent", propertyId: lease.propertyId,
      tenantId: lease.tenantId, leaseId: lease.id, amountCents: 85000, rentCents: 80000,
      chargesCents: 5000, counterparty: "Locataire départ anticipé", frequency: "monthly",
      startDate: `${year}-02-01`, endDate: "", active: true, generatedThrough: "", detail: "",
    });
    const response = await fetch("/api/test-fixtures/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: snapshot.state, revision: snapshot.revision, accountId: snapshot.user.id }) });
    if (!response.ok) throw new Error(await response.text());
  }, year);
  await page.reload();
  await go(page, "leases");
  await page.getByTestId("lease-card").getByRole("button", { name: /Ouvrir la location/ }).click();
  await top(page).getByRole("button", { name: "Modifier / terminer", exact: true }).click();
  await top(page).getByLabel("Date de sortie").fill(`${year}-01-31`);
  await top(page).getByRole("button", { name: "Enregistrer", exact: true }).click();
  await saved(page);
  await page.reload();
  const savedState = await state(page);
  expect(savedState.leases[0].endDate).toBe(`${year}-01-31`);
  expect(savedState.recurrences[0]).toMatchObject({ active: false, startDate: `${year}-02-01`, endDate: "" });
});


test("une location vraiment vide peut être supprimée avant de la recréer correctement",async({page})=>{
  await register(page);
  await property(page);
  await tenant(page,"Locataire à corriger");
  await lease(page,"Locataire à corriger","2026-01-01");
  await page.getByTestId("lease-card").getByRole("button",{name:/Ouvrir la location/}).click();
  await top(page).getByRole("button",{name:/Supprimer cette location vide/}).click();
  await top(page).getByRole("button",{name:"Supprimer la location vide",exact:true}).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByTestId("lease-card")).toHaveCount(0);
  await page.reload();
  expect((await state(page)).leases).toHaveLength(0);
  expect((await state(page)).tenants).toHaveLength(1);
  expect((await state(page)).properties).toHaveLength(1);
});
