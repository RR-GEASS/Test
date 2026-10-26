const tenantCategories = new Set(['rent','recoverable','deposit_received','deposit_returned']);
export function partyKind(category, type) {
  if (tenantCategories.has(category)) return 'tenant';
  if (category === 'contribution' || category === 'contribution_returned' || (type === 'income' && category !== 'loan_received')) return 'other';
  return 'supplier';
}
export function entryRequirements(value) {
  const errors = {};
  const kind = partyKind(value.category,value.type);
  if (kind === 'tenant') {
    if (!value.propertyId) errors.propertyId='Choisissez le bien concerné.';
    if (!value.leaseId) errors.leaseId='Choisissez la location pour identifier le bien et le locataire.';
    if (!value.tenantId) errors.tenantId='Le locataire de la location doit être renseigné.';
  } else if (kind === 'supplier') {
    if (!value.supplierId) errors.supplierId='Choisissez un fournisseur enregistré (banque, assureur ou prestataire).';
  } else if (!value.counterparty?.trim() && !value.supplierId && !value.tenantId) {
    errors.counterparty='Renseignez la personne ou l’organisme qui verse ou reçoit la somme.';
  }
  return errors;
}
// A single party selector is displayed for each operation. Related identifiers
// remain in the form to preserve the stored relationship and historical names.
export function configureEntryForm(dialog) {
  const form=dialog.querySelector('form');
  if(!form?.elements.category || !form.elements.type) return;
  let previousKind;
  const update=(event)=>{
    const kind=partyKind(form.elements.category.value,form.elements.type.value);
    if(previousKind && previousKind!==kind && ['type','category'].includes(event?.target?.name)) {
      for(const name of ['supplierId','tenantId','leaseId']) if(form.elements[name]) form.elements[name].value='';
      if(form.elements.counterparty) form.elements.counterparty.value='';
    }
    previousKind=kind;
    for(const name of ['supplierId','tenantId','leaseId','counterparty']) {
      const field=form.elements[name]; if(!field) continue;
      const visible=name===(kind==='supplier'?'supplierId':kind==='tenant'?'leaseId':'counterparty');
      field.closest('.form-field').hidden=!visible;
      field.required=visible;
      const label=field.closest('.form-field').querySelector('label');
      if(label) { const text=name==='supplierId'?'Fournisseur / banque *':name==='leaseId'?'Location et locataire *':name==='counterparty'?'Personne / organisme *':label.textContent; if(label.textContent!==text) label.textContent=text; }
    }
    // The selected location already identifies its property. Keep the property
    // selector as an optional filter until a location has been chosen.
    const property=form.elements.propertyId;
    if(property) { property.closest('.form-field').hidden=kind==='tenant' && !!form.elements.leaseId?.value; property.required=kind==='tenant'; }
    dialog.querySelectorAll('#inline-supplier,#inline-tenant,#inline-lease').forEach(b=>{b.hidden=b.id==='inline-supplier'?kind!=='supplier':kind!=='tenant';});
  };
  form.addEventListener('change',update);
  form.addEventListener('input',update);
  new MutationObserver(update).observe(form,{childList:true,subtree:true});
  update();
}

// Historical records remain readable. New entries and changes to their business
// identity must satisfy the same policy as the forms; payment-only updates can
// still settle legacy records without rewriting their history.
export function validateChangedEntries(state, previous) {
  const identityFields = ["type", "category", "date", "startDate", "endDate", "frequency", "paymentDay", "period", "propertyId", "supplierId", "tenantId", "leaseId", "counterparty", "amountCents", "rentCents", "chargesCents", "capitalCents", "interestCents", "insuranceCents"];
  for (const collection of ["transactions", "recurrences"]) {
    const old = new Map((previous[collection] || []).map(row => [row.id, row]));
    for (const row of state[collection] || []) {
      const before = old.get(row.id);
      if (before && identityFields.every(key => (before[key] ?? "") === (row[key] ?? ""))) continue;
      const errors = entryRequirements(row);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(" "));
    }
  }
  for (const property of state.properties || []) {
    const before = (previous.properties || []).find(row => row.id === property.id);
    const unchanged = before && ["name", "address", "rentCents", "chargesCents", "supplierIds"].every(key => JSON.stringify(before[key]) === JSON.stringify(property[key]));
    if (!property.address && !unchanged) throw new Error("Renseignez l’adresse du bien.");
  }
  for (const lease of state.leases || []) {
    const before = (previous.leases || []).find(row => row.id === lease.id);
    if (lease.rentCents <= 0 && (!before || before.rentCents !== lease.rentCents)) throw new Error("Le loyer hors charges doit être supérieur à zéro.");
  }
}
