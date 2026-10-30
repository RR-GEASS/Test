import { test, expect } from "@playwright/test";

const password="help-account-password-2026";
const dialog=page=>page.locator("dialog[open]").last();
async function navigate(page,view) {
  const button=page.locator(`aside nav [data-view="${view}"]`);
  await expect(button).toBeAttached();
  const group=button.locator("xpath=ancestor::details");
  if(await group.count() && !await group.evaluate(el=>el.open)) await group.locator("summary").click();
  if(!await button.isVisible()) await page.getByRole("button",{name:"Ouvrir la navigation"}).click();
  await button.click();
}
async function register(page,email) {
  await page.goto("/");
  await page.getByRole("button",{name:"Créer mon compte",exact:true}).click();
  await dialog(page).locator('[name="name"]').fill("SCI partagée");
  await dialog(page).locator('[name="email"]').fill(email);
  await dialog(page).locator('[name="password"]').fill(password);
  await dialog(page).getByRole("button",{name:"Créer mon compte",exact:true}).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByText("Enregistré en ligne",{exact:true})).toBeVisible();
}

test("chaque page possède une aide adaptée et le parcours de démarrage reste accessible sur téléphone",async({page})=>{
  test.setTimeout(60000);
  await page.goto("/");
  const views=["dashboard","transactions","recurrences","pointing","arrears","forecast","properties","suppliers","tenants","leases","bank-checks","exports","backups","access","history","storage"];
  for(const view of views) {
    await navigate(page,view);
    await page.locator('main [data-action="help"]').first().click();
    await expect(dialog(page)).toHaveClass(/help-dialog/);
    await expect(dialog(page).getByRole("heading",{name:/^Aide ·/})).toBeVisible();
    await expect(dialog(page).locator(".help-steps li").first()).toBeVisible();
    if(view==="dashboard") await page.screenshot({path:".artifacts/aide-desktop.png"});
    await dialog(page).getByRole("button",{name:"J’ai compris",exact:true}).click();
  }
  await navigate(page,"dashboard");
  await page.screenshot({path:".artifacts/navigation-simplifiee-desktop.png"});
  await page.setViewportSize({width:390,height:844});
  await page.locator('main [data-action="help"]').first().click();
  await expect(dialog(page).getByText("Bien démarrer avec votre SCI",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:".artifacts/aide-mobile.png"});
  await dialog(page).getByRole("button",{name:"Pointer le mois",exact:true}).click();
  await expect(page.locator('aside nav [data-view="pointing"]')).toHaveAttribute("aria-current","page");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("deux identifiants rejoignent le même espace par invitation et le membre ne gère pas les accès",async({page,browser})=>{
  const suffix=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ownerEmail=`owner-${suffix}@example.test`,memberEmail=`member-${suffix}@example.test`;
  await register(page,ownerEmail);
  await navigate(page,"properties");
  await page.locator('.page-heading [data-action="add-property"]').click();
  await dialog(page).locator('[name="name"]').fill("Bien commun");
  await dialog(page).locator('[name="address"]').fill("12 rue des Comptes");
  await dialog(page).getByRole("button",{name:"Ajouter le bien",exact:true}).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByText("Enregistré en ligne",{exact:true})).toBeVisible();
  await navigate(page,"access");
  await page.getByRole("button",{name:"Inviter une personne",exact:true}).click();
  await dialog(page).getByLabel("Adresse e-mail à inviter *").fill(memberEmail);
  await dialog(page).getByRole("button",{name:"Créer le lien d’invitation",exact:true}).click();
  await expect(dialog(page).getByLabel("Lien personnel d’invitation")).toBeVisible();
  const invitation=await dialog(page).getByLabel("Lien personnel d’invitation").inputValue();
  await dialog(page).locator(".dialog-footer").getByRole("button",{name:"Fermer",exact:true}).click();
  const context=await browser.newContext();
  try {
    const member=await context.newPage();
    await member.goto(invitation);
    await dialog(member).locator('[name="email"]').fill(memberEmail);
    await dialog(member).locator('[name="password"]').fill(password);
    await dialog(member).getByRole("button",{name:"Créer mon compte",exact:true}).click();
    await dialog(member).getByRole("button",{name:"Rejoindre la SCI",exact:true}).click();
    await expect(member.locator("dialog[open]")).toHaveCount(0);
    await navigate(member,"properties");
    await expect(member.getByTestId("property-card")).toContainText("Bien commun");
    await navigate(member,"access");
    await expect(member.getByText(ownerEmail,{exact:false})).toBeVisible();
    await expect(member.getByRole("button",{name:"Inviter une personne",exact:true})).toHaveCount(0);
    const session=await member.evaluate(async()=>(await(await fetch("/api/session")).json()));
    expect(session.user.email).toBe(memberEmail);
    expect(session.user.role).toBe("member");
    expect(session.state.properties[0].name).toBe("Bien commun");
    await page.reload();await navigate(page,"access");
    await expect(page.locator(".account-people").first()).toContainText(memberEmail);
    await page.getByRole("button",{name:"Retirer l’accès",exact:true}).click();
    await dialog(page).getByRole("button",{name:"Retirer l’accès",exact:true}).click();
    await expect(page.getByRole("button",{name:"Retirer l’accès",exact:true})).toHaveCount(0);
    const revoked=await member.evaluate(async()=>{
      const response=await fetch("/api/session");return {status:response.status,data:await response.json()};
    });
    expect(revoked.status===401 || revoked.data.state.properties.length===0).toBe(true);
  } finally {await context.close();}
});

test("le mot de passe se change depuis les accès et les espaces historique et documents sont utilisables",async({page})=>{
  const email=`account-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await register(page,email);
  await navigate(page,"access");
  await page.getByRole("button",{name:"Changer mon mot de passe",exact:true}).click();
  await dialog(page).getByLabel("Mot de passe actuel *").fill(password);
  await dialog(page).getByLabel("Nouveau mot de passe *",{exact:true}).fill("another-secure-password-2026");
  await dialog(page).getByLabel("Confirmer le nouveau mot de passe *").fill("another-secure-password-2026");
  await dialog(page).getByRole("button",{name:"Enregistrer le mot de passe",exact:true}).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await navigate(page,"history");
  await expect(page.getByRole("heading",{name:"Historique des modifications",exact:true})).toBeVisible();
  await expect(page.getByLabel("Rechercher une modification")).toBeVisible();
  await navigate(page,"storage");
  await expect(page.getByRole("heading",{name:"Espace des documents",exact:true})).toBeVisible();
  await expect(page.getByRole("progressbar",{name:"Espace de stockage utilisé"})).toBeVisible();
});
