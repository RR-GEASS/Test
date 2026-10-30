import { openView } from "./navigation.js";
import {test,expect} from '@playwright/test';
const d=page=>page.locator('dialog[open]').last();
async function setup(page) {
  await page.goto('/');await page.getByRole('button',{name:'Créer mon compte',exact:true}).click();
  await d(page).getByLabel('Nom de votre SCI').fill('SCI qualité');
  await d(page).getByLabel('Adresse e-mail').fill(`quality-${Date.now()}-${Math.random()}@example.test`);
  await d(page).getByLabel('Mot de passe').fill('required-browser-password-2026');
  await d(page).getByRole('button',{name:'Créer mon compte',exact:true}).click();
  await expect(d(page)).not.toBeVisible();
  await page.evaluate(async()=>{
    const a=await(await fetch('/api/session')).json();
    a.state.properties=[{id:'p',name:'Appartement 1',address:'1 rue des Tests',tenant:'',rentCents:80000,chargesCents:5000,archived:false}];
    a.state.suppliers=[{id:'s',name:'Assureur',legalName:'',address:'',email:'',phone:'',siret:'',reference:'',notes:'',category:'insurance',archived:false}];
    a.state.tenants=[{id:'t',name:'Locataire Exemple',address:'',email:'',phone:'',notes:'',archived:false}];
    a.state.leases=[{id:'l',propertyId:'p',tenantId:'t',startDate:'2026-01-01',endDate:'',rentCents:80000,chargesCents:5000,depositCents:80000,paymentDay:1,notes:''}];
    const r=await fetch('/api/test-fixtures/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:a.state,revision:a.revision,accountId:a.user.id})});if(!r.ok)throw new Error(await r.text());
  });await page.reload();
}
test('une dépense exige son fournisseur et ne présente qu’un seul champ pour le choisir',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'Nouvelle opération',exact:true}).click();
  await d(page).locator('[name=type]').selectOption('expense');
  await d(page).locator('[name=category]').selectOption('insurance');
  await expect(d(page).locator('.entity-search')).toHaveCount(0);
  await expect(d(page).locator('[name=supplierId]')).toBeVisible();
  await expect(d(page).locator('[name=tenantId]')).not.toBeVisible();
  await expect(d(page).locator('[name=leaseId]')).not.toBeVisible();
  await expect(d(page).locator('[name=counterparty]')).not.toBeVisible();
  await d(page).locator('[name=amount]').fill('100');
  await d(page).getByRole('button',{name:'Ajouter l’opération',exact:true}).click();
  await expect(d(page).getByRole('alert')).toContainText(/fournisseur/i);
  await d(page).locator('[name=supplierId]').selectOption('s');
  await expect(d(page).locator('[name=supplierId]')).toHaveAttribute('aria-invalid','false');
  await d(page).getByRole('button',{name:'Ajouter l’opération',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const state=await page.evaluate(async()=>(await(await fetch('/api/session')).json()).state);
  expect(state.transactions[0]).toMatchObject({supplierId:'s',amountCents:10000});
});
test('le loyer périodique exige une location et masque les saisies déjà déduites de ce choix',async({page})=>{
  await setup(page);await openView(page,'recurrences');
  await page.getByRole('button',{name:'Nouvelle périodicité',exact:true}).click();
  await expect(d(page).locator('[name=supplierId]')).not.toBeVisible();
  await expect(d(page).locator('[name=tenantId]')).not.toBeVisible();
  await expect(d(page).locator('[name=counterparty]')).not.toBeVisible();
  await d(page).locator('[name=rent]').fill('800');await d(page).locator('[name=charges]').fill('50');
  await d(page).getByRole('button',{name:'Créer la périodicité',exact:true}).click();
  await expect(d(page).getByRole('alert')).toContainText(/location|locataire|bien/i);
  await d(page).locator('[name=leaseId]').selectOption('l');
  await expect(d(page).locator('[name=propertyId]')).not.toBeVisible();
  await expect(d(page).locator('[name=leaseId]')).toHaveAttribute('aria-invalid','false');
  await expect(d(page).locator('[name=tenantId]')).toHaveValue('t');
  await page.screenshot({path:'.artifacts/periodicite-simplifiee-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'.artifacts/periodicite-simplifiee-mobile.png'});
  await d(page).getByRole('button',{name:'Créer la périodicité',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const state=await page.evaluate(async()=>(await(await fetch('/api/session')).json()).state);
  expect(state.recurrences[0]).toMatchObject({leaseId:'l',tenantId:'t',propertyId:'p'});
});
test('les fiches biens et fournisseurs signalent les informations invalides avant de sauvegarder',async({page})=>{
  await setup(page);await openView(page,'properties');
  await page.locator('.page-heading [data-action=add-property]').click();
  await d(page).locator('[name=name]').fill('Bien incomplet');
  await d(page).getByRole('button',{name:'Ajouter le bien',exact:true}).click();
  await expect(d(page).getByRole('alert')).toContainText(/adresse/i);
  await d(page).locator('[name=address]').fill('2 rue des Tests');
  await d(page).getByRole('button',{name:'Ajouter le bien',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await openView(page,'suppliers');
  await page.locator('.page-heading [data-action=add-supplier]').click();
  await d(page).locator('[name=name]').fill('Fournisseur incomplet');
  await d(page).locator('[name=siret]').fill('123');
  await d(page).locator('[name=email]').fill('invalide');
  await d(page).getByRole('button',{name:'Créer le fournisseur',exact:true}).click();
  await expect(d(page).getByRole('alert')).toContainText(/SIRET/i);
  await expect(d(page).getByRole('alert')).toContainText(/e-mail/i);
});


test('choisir une banque ou une location ne transforme pas un emprunt reçu ou une restitution en dépense ou loyer',async({page})=>{
  await setup(page);await openView(page,'recurrences');
  await page.getByRole('button',{name:'Nouvelle périodicité',exact:true}).click();
  await d(page).locator('[name=category]').selectOption('loan_received');
  await d(page).locator('[name=supplierId]').selectOption('s');
  await expect(d(page).locator('[name=type]')).toHaveValue('income');
  await expect(d(page).locator('[name=category]')).toHaveValue('loan_received');
  await d(page).getByRole('button',{name:'Annuler',exact:true}).click();
  await d(page).getByRole('button',{name:'Abandonner',exact:true}).click();
  await page.getByRole('button',{name:'Nouvelle périodicité',exact:true}).click();
  await d(page).locator('[name=type]').selectOption('expense');
  await d(page).locator('[name=category]').selectOption('deposit_returned');
  await d(page).locator('[name=leaseId]').selectOption('l');
  await expect(d(page).locator('[name=type]')).toHaveValue('expense');
  await expect(d(page).locator('[name=category]')).toHaveValue('deposit_returned');
  await expect(d(page).locator('[name=amount]')).toHaveValue('800,00');
});
