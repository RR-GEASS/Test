import { expect } from '@playwright/test';
export async function revealNav(page, button) {
  await expect(page.locator('aside nav')).toBeAttached();
  await expect(page.locator('.sync-indicator')).not.toContainText('Enregistrement…');
  const menu=page.getByRole('button',{name:'Ouvrir la navigation',exact:true});
  if(await menu.isVisible() && !(await page.locator('body').evaluate(el=>el.classList.contains('sidebar-open')))) await menu.click();
  // Role locators omit controls in a closed details group. Reveal groups before
  // resolving the requested role; raw CSS locators can still target a group.
  for (const group of await page.locator('aside nav details').all())
    if(!await group.evaluate(el=>el.open)) await group.locator('summary').click();
  await expect(button).toBeAttached();
}
export async function openView(page, view) {
  const button=page.locator(`aside nav [data-view="${view}"]`);
  await revealNav(page,button);
  await button.click();
}
