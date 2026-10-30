import { revealNav } from "./navigation.js";
import {test,expect} from '@playwright/test';
const currentDate = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(new Date());
async function setup(page) {
  await page.goto('/');
  await page.getByRole('button',{name:'Créer mon compte',exact:true}).click();
  const d=page.getByRole('dialog');
  await d.getByLabel('Nom de votre SCI').fill('SCI liens');
  await d.getByLabel('Adresse e-mail').fill(`links-${Date.now()}-${Math.random()}@example.test`);
  await d.getByLabel('Mot de passe').fill('assisted-links-password-2026');
  await d.getByRole('button',{name:'Créer mon compte',exact:true}).click();
  await expect(d).not.toBeVisible();
  await page.evaluate(async () => {
    const a=await(await fetch('/api/session')).json();
    Object.assign(a.state,{
      properties:[{id:'p',name:'Bien A',address:'Rue A',tenant:'',rentCents:80000,chargesCents:5000,archived:false}],
      suppliers:[{id:'s',name:'Artisan Lié',legalName:'Artisan SARL',category:'maintenance',reference:'Contrat A',address:'',email:'',phone:'',siret:'',notes:'',archived:false}],
      tenants:[{id:'t',name:'Locataire Lié',email:'',phone:'',address:'',notes:'',archived:false}],
      leases:[{id:'l',propertyId:'p',tenantId:'t',startDate:'2026-01-01',endDate:'',rentCents:80000,chargesCents:5000,depositCents:80000,paymentDay:5,notes:''}]
    });
    const r=await fetch('/api/test-fixtures/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:a.state,revision:a.revision,accountId:a.user.id})});
    if(!r.ok) throw new Error(await r.text());
  });
  await page.reload();
}
async function saved(page) { await expect(page.getByText('Enregistré en ligne',{exact:true})).toBeVisible(); }
async function nav(page,name) { const button=page.locator('aside nav').getByRole('button',{name:name==='Biens immobiliers'?/^Biens immobiliers/:name,exact:name!=='Biens immobiliers'});await revealNav(page,button);await button.click(); }
async function state(page) { return page.evaluate(async()=> (await(await fetch('/api/session')).json()).state); }

test('les recherches assistées enregistrent les liens réels des biens, fournisseurs et opérations',async({page})=>{
  await setup(page);
  await nav(page,'Biens immobiliers');
  await page.getByTestId('property-card').getByRole('button',{name:'Modifier',exact:true}).click();
  const d=page.getByRole('dialog');
  await d.getByRole('checkbox',{name:'Artisan Lié',exact:true}).check();
  await d.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await saved(page);
  await page.reload();
  expect((await state(page)).properties[0].supplierIds).toEqual(['s']);
  await page.getByRole('button',{name:'Nouvelle opération',exact:true}).click();
  await d.getByLabel('Type',{exact:true}).selectOption('expense');
  await d.locator('[name=supplierId]').selectOption('s');
  await expect(d.locator('[name=supplierId]')).toHaveValue('s');
  await expect(d.locator('[name=propertyId]')).toHaveValue('p');
  await expect(d.locator('[name=category]')).toHaveValue('maintenance');
  await d.locator('[name=amount]').fill('123');
  await d.getByRole('button',{name:'Ajouter l’opération',exact:true}).click();
  await saved(page);
  await page.reload();
  expect((await state(page)).transactions[0]).toMatchObject({supplierId:'s',propertyId:'p',counterparty:'Artisan Lié'});
  await nav(page,'Biens immobiliers');
  await page.getByRole('button',{name:'Dossier du bien',exact:true}).click();
  await expect(d).toContainText('Artisan Lié');
  await expect(d).toContainText('Locataire Lié');
  await d.getByRole('button',{name:'Ouvrir la fiche',exact:true}).click();
  await expect(d).toContainText('Biens associés');
  await expect(d).toContainText('Bien A');
});

test('le choix du bien ou du locataire retrouve sa location et conserve les liens après rechargement',async({page})=>{
  await setup(page);
  const d=page.getByRole('dialog');
  await page.getByRole('button',{name:'Nouvelle opération',exact:true}).click();
  await d.locator('[name=leaseId]').selectOption('l');
  await expect(d.locator('[name=tenantId]')).toHaveValue('t');
  await expect(d.locator('[name=leaseId]')).toHaveValue('l');
  await expect(d.locator('[name=rent]')).toHaveValue('800,00');
  await d.getByRole('button',{name:'Ajouter l’opération',exact:true}).click();
  await saved(page);
  await page.reload();
  expect((await state(page)).transactions[0]).toMatchObject({tenantId:'t',leaseId:'l',propertyId:'p',amountCents:85000});
  await nav(page,'Opérations périodiques');
  await page.getByRole('button',{name:'Nouvelle périodicité',exact:true}).click();
  await d.locator('[name=leaseId]').selectOption('l');
  await expect(d.locator('[name=leaseId]')).toHaveValue('l');
  await expect(d.locator('[name=propertyId]')).toHaveValue('p');
  await d.getByLabel('Date de début *').fill(currentDate());
  await d.getByRole('button',{name:'Créer la périodicité',exact:true}).click();
  await saved(page);
  await page.reload();
  expect((await state(page)).recurrences[0]).toMatchObject({tenantId:'t',leaseId:'l',propertyId:'p'});
});


test('rattacher un fournisseur à une ancienne opération réglée conserve sa catégorie, son montant et ses paiements',async({page})=>{
  await setup(page);
  await page.evaluate(async date=>{
    const a=await(await fetch('/api/session')).json();
    a.state.properties[0].supplierIds=['s'];
    a.state.transactions.push({id:'past',date,type:'expense',status:'paid',label:'Ancienne facture',category:'insurance',propertyId:'',amountCents:4200,counterparty:'Ancien libellé',reference:'OLD',notes:'',payments:[{id:'payment',date,amountCents:4200,rentCents:0,chargesCents:0}]});
    const r=await fetch('/api/test-fixtures/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:a.state,revision:a.revision,accountId:a.user.id})});if(!r.ok)throw new Error(await r.text());
  },currentDate());
  await page.reload();
  const before=(await state(page)).transactions[0];
  await nav(page,'Opérations');
  await page.getByTestId('operation-row').getByRole('button',{name:'Ancienne facture',exact:true}).click();
  const d=page.getByRole('dialog');
  await d.locator('[name=supplierId]').selectOption('s');
  await expect(d.locator('[name=category]')).toHaveValue('insurance');
  await expect(d.locator('[name=propertyId]')).toHaveValue('');
  await d.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await saved(page);
  await page.reload();
  const after=(await state(page)).transactions[0];
  expect(after.supplierId).toBe('s');
  expect(after.amountCents).toBe(before.amountCents);
  expect(after.payments).toEqual(before.payments);
  expect(after.category).toBe(before.category);
});
