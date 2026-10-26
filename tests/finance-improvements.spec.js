import { test, expect } from "@playwright/test";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
async function navigate(page,name) {
  const button = page.locator("aside nav").getByRole("button",{name,exact:true});
  await expect(button).toBeAttached();
  if (!(await button.isVisible())) await page.getByRole("button",{name:"Ouvrir la navigation"}).click();
  await button.click();
}
async function register(page) {
  await page.goto("/");
  await page.getByRole("button",{name:"Créer mon compte",exact:true}).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nom de votre SCI").fill("SCI finance pratique");
  await d.getByLabel("Adresse e-mail").fill(`finance-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await d.getByLabel("Mot de passe").fill("finance-pratique-password-2026");
  await d.getByRole("button",{name:"Créer mon compte",exact:true}).click();
  await expect(d).not.toBeVisible();
}
async function seed(page, additions) {
  await page.evaluate(async additions => {
    const session = await (await fetch("/api/session")).json();
    const state = {...session.state,...additions};
    const response = await fetch("/api/test-fixtures/state",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state,revision:session.revision,accountId:session.user.id})});
    if (!response.ok) throw new Error(JSON.stringify(await response.json()));
  },additions);
  await page.reload();
}
async function state(page) { return page.evaluate(async () => (await (await fetch("/api/session")).json()).state); }
const property = (id,name) => ({id,name,address:"",tenant:"",rentCents:80000,chargesCents:5000,archived:false});
const transaction = (id,propertyId,type="expense",status="pending") => ({id,propertyId,date:today(),dueDate:today(),type,status,category:type === "income" ? "rent" : "insurance",label:id,amountCents:10000,counterparty:"",reference:"",notes:""});

test("le pointage filtre les biens et les mouvements sans régler une ligne masquée",async ({page}) => {
  await register(page);
  await seed(page,{properties:[property("p1","Bien A"),property("p2","Bien B")],transactions:[transaction("dépense A","p1"),transaction("loyer A","p1","income"),transaction("dépense B","p2")]});
  await navigate(page,"Pointage mensuel");
  await page.getByRole("checkbox",{name:"Tout sélectionner",exact:true}).check();
  await page.getByLabel("Bien à pointer",{exact:true}).selectOption("p1");
  await expect(page.getByRole("button",{name:"Valider les règlements",exact:true})).toBeDisabled();
  await page.getByLabel("Sens des opérations",{exact:true}).selectOption("expense");
  await expect(page.getByTestId("pointing-row")).toHaveCount(1);
  await page.getByRole("checkbox",{name:"Tout sélectionner",exact:true}).check();
  await page.getByRole("button",{name:"Valider les règlements",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Valider les règlements",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Enregistré en ligne",{exact:true})).toBeVisible();
  const saved = await state(page);
  expect(saved.transactions.find(t=>t.id === "dépense A").status).toBe("paid");
  expect(saved.transactions.filter(t=>t.id !== "dépense A").every(t=>t.status === "pending")).toBe(true);
  await page.getByLabel("Échéances affichées",{exact:true}).selectOption("remaining");
  await expect(page.getByTestId("pointing-row")).toHaveCount(0);
});

test("un contrôle compare le relevé aux règlements réels et conserve sa valeur après rechargement", async ({page}) => {
  await register(page);
  await seed(page,{settings:{name:"SCI finance pratique",taxRegime:"IS",openingDate:today().slice(0,4)+"-01-01",openingBalanceCents:100000},transactions:[transaction("loyer payé","","income","paid"),transaction("assurance payée","","expense","paid"),transaction("assurance prévue","")]});
  await navigate(page,"Contrôle bancaire");
  await page.getByRole("button",{name:"Comparer un solde",exact:true}).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Solde sur le relevé (€) *").fill("1020");
  await expect(d.locator("#bank-comparison")).toContainText("20,00");
  await d.getByRole("button",{name:"Enregistrer le contrôle",exact:true}).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByTestId("bank-check-row")).toContainText("20,00");
  const before = await state(page);
  expect(before.bankChecks[0].balanceCents).toBe(102000);
  expect(before.transactions).toHaveLength(3);
  await page.reload();
  await navigate(page,"Contrôle bancaire");
  await expect(page.getByTestId("bank-check-row")).toContainText("20,00");
});

test("une location préremplit une périodicité et conserve le locataire lié",async ({page}) => {
  await register(page);
  await seed(page,{properties:[property("p1","Bien A")],tenants:[{id:"tenant1",name:"Camille Exemple",email:"",phone:"",address:"",notes:"",archived:false}],leases:[{id:"lease1",tenantId:"tenant1",propertyId:"p1",startDate:today().slice(0,7)+"-01",endDate:"",rentCents:75000,chargesCents:4500,depositCents:75000,paymentDay:1,notes:""}]});
  await navigate(page,"Opérations périodiques");
  await page.getByRole("button",{name:"Nouvelle périodicité",exact:true}).click();
  const d = page.getByRole("dialog");
  await d.locator('[name=leaseId]').selectOption("lease1");
  await expect(d.getByLabel("Loyer hors charges (€) *")).toHaveValue("750,00");
  await expect(d.locator('[name=counterparty]')).toHaveValue("Camille Exemple");
  await d.getByRole("button",{name:"Créer la périodicité",exact:true}).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByText("Enregistré en ligne",{exact:true})).toBeVisible();
  const saved = await state(page);
  expect(saved.recurrences[0]).toMatchObject({leaseId:"lease1",tenantId:"tenant1",propertyId:"p1",amountCents:79500});
  expect(saved.transactions[0]).toMatchObject({leaseId:"lease1",tenantId:"tenant1",counterparty:"Camille Exemple",amountCents:79500});
});

test("plusieurs pièces peuvent être ajoutées même si l’une d’elles est refusée",async ({page}) => {
  await register(page);
  await seed(page,{transactions:[transaction("facture","")]});
  await navigate(page,"Pointage mensuel");
  await page.getByRole("button",{name:"Justificatifs",exact:true}).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Ajouter un justificatif",{exact:true}).setInputFiles([
    {name:"facture-1.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")},
    {name:"faux.pdf",mimeType:"application/pdf",buffer:Buffer.from("not a PDF")},
    {name:"facture-2.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n2 0 obj\n<<>>\nendobj\n%%EOF")},
  ]);
  await expect(d.getByRole("link")).toHaveCount(2);
  await expect(d.getByRole("alert")).toContainText("faux.pdf");
  await expect(d.getByRole("alert")).toContainText("2 fichier(s) enregistré(s)");
});
