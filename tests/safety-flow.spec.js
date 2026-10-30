import {test,expect} from '@playwright/test';
import {openView} from './navigation.js';
const dialog=page=>page.locator('dialog[open]').last();
async function register(page) {
  await page.goto('/');await page.getByRole('button',{name:'Créer mon compte',exact:true}).click();
  await dialog(page).locator('[name=name]').fill('SCI historique');
  await dialog(page).locator('[name=email]').fill(`safety-${Date.now()}-${Math.random()}@example.test`);
  await dialog(page).locator('[name=password]').fill('safety-browser-password-2026');
  await dialog(page).getByRole('button',{name:'Créer mon compte',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
test('une opération réglée est annulée avec motif et paiements conservés dans son historique',async({page})=>{
  await register(page);
  await page.evaluate(async()=>{
    const a=await(await fetch('/api/session')).json(),date=new Date().toISOString().slice(0,10);
    a.state.transactions=[{id:'paid',date,type:'expense',status:'paid',label:'Assurance réglée',category:'insurance',propertyId:'',amountCents:10000,counterparty:'Assureur historique',reference:'FACT',notes:'',payments:[{id:'p',date,amountCents:10000,rentCents:0,chargesCents:0}]}];
    const r=await fetch('/api/test-fixtures/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:a.state,revision:a.revision,accountId:a.user.id})});if(!r.ok)throw new Error(await r.text());
  });await page.reload();await openView(page,'transactions');
  await page.getByTestId('operation-row').getByRole('button',{name:/^Actions pour/}).click();
  await expect(page.getByRole('menuitem',{name:'Supprimer',exact:true})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'Annuler l’opération',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Confirmer l’annulation',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await dialog(page).locator('[name=reason]').fill('Doublon de saisie confirmé');
  await dialog(page).getByRole('button',{name:'Confirmer l’annulation',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByTestId('operation-row')).toHaveCount(0);
  const snapshot=await page.evaluate(async()=>(await(await fetch('/api/session')).json()).state);
  expect(snapshot.transactions[0].payments).toHaveLength(1);
  expect(snapshot.transactions[0].cancellationReason).toBe('Doublon de saisie confirmé');
  await page.getByLabel('Filtrer par statut',{exact:true}).selectOption('cancelled');
  await expect(page.getByTestId('operation-row')).toContainText('Annulée');
  await openView(page,'history');await expect(page.locator('.history-list')).toContainText('Annulation');
});
test('une ancienne sauvegarde incomplète peut être restaurée et l’état précédent reste accessible',async({page})=>{
  await register(page);await openView(page,'backups');
  const state=await page.evaluate(async()=>(await(await fetch('/api/session')).json()).state);
  state.transactions=[{id:'old',date:new Date().toISOString().slice(0,10),type:'expense',status:'pending',label:'Ancienne facture',category:'maintenance',propertyId:'',amountCents:5000,counterparty:'Ancien artisan',reference:'',notes:''}];
  await page.locator('#import-file').setInputFiles({name:'ancienne.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(state))});
  await dialog(page).getByRole('button',{name:'Remplacer mes données',exact:true}).click();
  await expect(page.getByText('Enregistré en ligne',{exact:true})).toBeVisible();
  await openView(page,'transactions');await expect(page.getByTestId('operation-row')).toContainText('Ancienne facture');
  await openView(page,'history');await expect(page.locator('.history-list')).toContainText('Restauration');
  await expect(page.locator('#restore-states')).toBeVisible();
});
