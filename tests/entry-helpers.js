import { expect } from '@playwright/test';
// Explicitly load historical fixtures before UI flows; normal application saves
// still use the real endpoint and its mandatory-field checks.
export async function rentalFixtures(page) {
  const active=await page.locator('aside nav .active').getAttribute('data-view');
  await page.evaluate(async()=>{
    const a=await(await fetch('/api/session')).json();
    for(const p of a.state.properties) {
      if(a.state.leases.some(l=>l.propertyId===p.id))continue;
      const tenant={id:`fixture-tenant-${p.id}`,name:p.tenant || 'Locataire de test',email:'',phone:'',address:'',notes:'',archived:false};
      a.state.tenants.push(tenant);
      a.state.leases.push({id:`fixture-lease-${p.id}`,tenantId:tenant.id,propertyId:p.id,startDate:'1900-01-01',endDate:'',rentCents:p.rentCents || 80000,chargesCents:p.chargesCents || 0,depositCents:0,paymentDay:1,notes:''});
    }
    const r=await fetch('/api/test-fixtures/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:a.state,revision:a.revision,accountId:a.user.id})});
    if(!r.ok)throw new Error(await r.text());
  });
  await page.reload();
  if(active) {
    const b=page.locator(`aside nav [data-view="${active}"]`);
    await expect(b).toBeAttached();
    if(!await b.isVisible())await page.getByRole('button',{name:'Ouvrir la navigation'}).click();
    await b.click();
  }
}
export async function completeEntry(page, dialog, name='Fournisseur de test') {
  const category=await dialog.locator('[name=category]').inputValue();
  const type=await dialog.locator('[name=type]').inputValue();
  if(['rent','recoverable','deposit_received','deposit_returned'].includes(category)) {
    const select=dialog.locator('[name=leaseId]');
    if(!await select.inputValue()) {
      const value=await select.locator('option').evaluateAll(options=>options.find(o=>o.value)?.value);
      if(value) await select.selectOption(value);
    }
    return;
  }
  if(category==='contribution'||category==='contribution_returned'||(type==='income'&&category!=='loan_received')) {
    const input=dialog.locator('[name=counterparty]');
    if(!await input.inputValue())await input.fill(name);
    return;
  }
  if(await dialog.locator('[name=supplierId]').inputValue()) return;
  const categoryValue=category;
  const option=await dialog.locator('[name=supplierId] option').evaluateAll((options,name)=>options.find(o=>o.textContent===name)?.value,name);
  if(option) { await dialog.locator('[name=supplierId]').selectOption(option);return; }
  await dialog.getByRole('button',{name:'Créer un fournisseur',exact:true}).click();
  const child=page.locator('dialog[open]').last();
  await child.locator('[name=name]').fill(name);
  await child.locator('[name=category]').selectOption(categoryValue);
  await child.getByRole('button',{name:'Créer le fournisseur',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(dialog.locator('[name=supplierId]')).not.toHaveValue('');
}
