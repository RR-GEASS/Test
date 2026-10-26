export function assistEntityFields(root) {
  const names=new Set(['propertyId','supplierId','tenantId','leaseId']);
  const enhance=()=>root.querySelectorAll('select[name]').forEach(select=>{
    if(!names.has(select.name)||select.dataset.assisted) return;
    select.dataset.assisted='true';
    select.title='Choisissez dans la liste ; tapez les premières lettres pour retrouver une fiche.';
  });
  enhance();
  const observer=new MutationObserver(enhance);
  observer.observe(root,{childList:true,subtree:true});
  root.addEventListener('close',()=>observer.disconnect(),{once:true});
}
