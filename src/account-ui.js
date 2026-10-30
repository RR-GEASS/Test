import { api } from "./api.js";
import { icon, esc } from "./ui.js";
import { money } from "./model.js";
import "./consolidation.css";

const dateTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : new Intl.DateTimeFormat("fr-FR", {dateStyle:"short",timeStyle:"short",timeZone:"Europe/Paris"}).format(date);
};
const bytes = value => new Intl.NumberFormat("fr-FR", {maximumFractionDigits:1}).format((Number(value) || 0) / 1024 / 1024) + " Mo";
const rowLabels = {
  label:"Libellé", name:"Nom", date:"Date", startDate:"Début", endDate:"Fin", amountCents:"Montant", rentCents:"Loyer hors charges", chargesCents:"Provisions", status:"État", cancelledAt:"Date d’annulation", cancellationReason:"Motif d’annulation", archived:"Fiche désactivée",
};
const valueText = (key, value) => {
  if (value === undefined || value === null || value === "") return "—";
  if (key.endsWith("Cents") && Number.isSafeInteger(value)) return money(value);
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return ({paid:"Réglé",pending:"En attente",cancelled:"Annulé"})[value] || String(value);
};
const actionLabel = action => ({create:"Création",update:"Modification",delete:"Suppression",cancel:"Annulation",restore:"Restauration",rent_change:"Changement de loyer"})[action] || action || "Modification";

export function createAccountUI(ctx) {
  let activeView = "", activeContent = null, renderId = 0;
  const owner = () => ctx.getUser()?.role !== "member";
  function error(content, message) {
    let el = content.querySelector(".account-page-error");
    if (!el) { el = document.createElement("p"); el.className="finance-error account-page-error";el.setAttribute("role","alert");content.prepend(el); }
    el.textContent=message;
  }
  function bind(content) {
    content.querySelectorAll("[data-account-action]").forEach(button => button.addEventListener("click", () => action(button.dataset.accountAction,button.dataset.id)));
  }
  async function render(view, content) {
    if (!["access","history","storage"].includes(view)) return false;
    activeView=view; activeContent=content;
    const requested=++renderId;
    if (!ctx.getUser()) {
      content.innerHTML=`<section class="panel account-panel"><div class="empty-state">${icon("lock")}<h2>Votre espace personnel</h2><p>Connectez-vous pour gérer les accès, les documents et l’historique de votre SCI.</p><button class="button primary" data-action="auth">Créer mon compte / me connecter</button></div></section>`;
      return true;
    }
    content.innerHTML='<section class="panel account-panel"><p role="status">Chargement…</p></section>';
    try {
      if (view === "access") {
        const data=await api("/access");
        if (requested!==renderId || !content.isConnected) return true;
        content.innerHTML=`<section class="panel account-panel"><div class="panel-heading"><div><h2>Les personnes qui accèdent à cette SCI</h2><p>Chacun utilise son identifiant et son mot de passe. Les données de la SCI sont communes.</p></div>${data.role === "owner" ? '<button class="button primary" data-account-action="invite-member">Inviter une personne</button>' : ""}</div>${data.role === "owner" ? `<ul class="account-people">${data.members.map(member=>`<li><span><strong>${esc(member.email)}</strong><small>${member.role === "owner" ? "Propriétaire de l’espace" : "Accès partagé"}${member.id===ctx.getUser().id ? " · Vous" : ""}</small></span>${member.role !== "owner" ? `<button type="button" class="text-link danger-text" data-account-action="remove-member" data-id="${esc(member.id)}">Retirer l’accès</button>` : ""}</li>`).join("")}</ul><p class="form-note">Cet espace est prévu pour deux personnes. Retirer un accès conserve les données et les modifications déjà enregistrées.</p><h3 class="account-subtitle">Invitations en attente</h3><ul class="account-people">${(data.invitations || []).map(invite=>`<li><span><strong>${esc(invite.email)}</strong><small>Valable jusqu’au ${esc(dateTime(invite.expiresAt))}</small></span><button type="button" class="text-link danger-text" data-account-action="revoke-invitation" data-id="${esc(invite.id)}">Annuler l’invitation</button></li>`).join("") || '<li>Aucune invitation en attente.</li>'}</ul>` : `<div class="notice">${icon("lock")}<span>Vous utilisez l’espace partagé de ${esc(data.ownerEmail || "son propriétaire")}. Le propriétaire gère les invitations et les accès.</span></div>`}</section><section class="panel account-panel"><div class="panel-heading"><div><h2>Votre mot de passe</h2><p>Connecté avec ${esc(ctx.getUser().email)}. Utilisez un mot de passe personnel que vous ne partagez pas.</p></div><button class="button secondary" data-account-action="change-password">Changer mon mot de passe</button></div></section>`;
      } else if (view === "history") {
        const data=await api("/history");
        if (requested!==renderId || !content.isConnected) return true;
        content.innerHTML=`<section class="panel account-panel"><div class="panel-heading"><div><h2>Historique des modifications</h2><p>Les dernières modifications enregistrées, avec leur date et leur auteur.</p></div></div><div class="search-field account-search">${icon("search")}<input type="search" id="history-search" aria-label="Rechercher une modification" placeholder="Opération, fiche, personne…"></div><div id="history-entries"></div></section>${owner() ? '<section class="panel account-panel"><details id="restore-states"><summary>États conservés avant une restauration</summary><p class="form-note">Ces états permettent de retrouver les données précédant une restauration. Ils ne contiennent pas les fichiers et ne remplacent pas une sauvegarde complète hors du serveur.</p><div id="restore-state-list">Chargement…</div></details></section>' : ""}`;
        const entries=data.entries || [];
        const draw=()=>{
          const query=content.querySelector("#history-search").value.toLocaleLowerCase("fr");
          const selected=entries.filter(entry=>`${entry.summary} ${entry.actorEmail} ${entry.entityType} ${entry.entityId}`.toLocaleLowerCase("fr").includes(query));
          content.querySelector("#history-entries").innerHTML=selected.length ? `<ol class="history-list">${selected.map(entry=>{
            const before=entry.before || {}, after=entry.after || {};
            const changes=Object.keys(rowLabels).filter(key=>(before[key] ?? "") !== (after[key] ?? ""));
            return `<li data-testid="history-entry"><div class="history-meta"><span class="status-pill pending">${esc(actionLabel(entry.action))}</span><time>${esc(dateTime(entry.createdAt))}</time></div><strong>${esc(entry.summary || "Données mises à jour")}</strong><span class="history-actor">${esc(entry.actorEmail || "Action du système")}</span>${changes.length ? `<details><summary>Voir le détail</summary><dl class="history-changes">${changes.map(key=>`<div><dt>${esc(rowLabels[key])}</dt><dd><span>${esc(valueText(key,before[key]))}</span><span aria-hidden="true"> → </span><strong>${esc(valueText(key,after[key]))}</strong></dd></div>`).join("")}</dl></details>` : ""}</li>`;
          }).join("")}</ol>` : '<div class="empty-state"><h3>Aucune modification à afficher</h3><p>Les nouvelles créations et corrections enregistrées apparaîtront ici.</p></div>';
        };
        draw();content.querySelector("#history-search").addEventListener("input",draw);
        if(owner()) loadRestoreStates(content,requested);
      } else {
        const data=await api("/storage");
        if (requested!==renderId || !content.isConnected) return true;
        const percent=data.maxBytes ? Math.min(100,Math.round(data.usedBytes/data.maxBytes*100)) : 0;
        content.innerHTML=`<section class="panel account-panel"><div class="panel-heading"><div><h2>Espace des documents</h2><p>Les justificatifs et les documents des fiches partagent le même espace de stockage.</p></div></div><div class="storage-amount"><strong>${bytes(data.usedBytes)}</strong><span>utilisés sur ${bytes(data.maxBytes)}</span></div><progress class="storage-progress" max="100" value="${percent}" aria-label="Espace de stockage utilisé">${percent} %</progress><dl class="storage-summary"><div><dt>Justificatifs des opérations</dt><dd>${bytes(data.operationBytes)}</dd></div><div><dt>Documents des fiches</dt><dd>${bytes(data.entityBytes)}</dd></div><div><dt>Sans opération ou fiche actuelle</dt><dd>${bytes(data.orphanBytes)} · ${Number(data.orphanCount) || 0} document(s)</dd></div></dl><p class="form-note">Les pièces sans rattachement peuvent provenir d’une opération supprimée ou d’une ancienne restauration. Une fiche désactivée conserve ses documents normalement.</p></section>${owner() ? '<section class="panel account-panel"><div class="panel-heading"><div><h2>Documents sans rattachement</h2><p>Vérifiez votre sauvegarde avant un nettoyage. La suppression d’un fichier est définitive.</p></div></div><div id="orphan-documents">Chargement…</div></section>' : '<p class="form-note">Le propriétaire de l’espace peut nettoyer les documents sans rattachement.</p>'}`;
        if(owner()) loadOrphans(content,requested);
      }
      bind(content);
    } catch(e) { if(requested===renderId && content.isConnected) error(content,e.message); }
    return true;
  }
  async function loadRestoreStates(content,requested) {
    try {
      const data=await api("/restore/snapshots");
      if(requested!==renderId || !content.isConnected) return;
      const target=content.querySelector("#restore-state-list");
      target.innerHTML=`<ul class="account-people">${(data.snapshots || []).map(snapshot=>`<li><span><strong>${esc(snapshot.name || "État précédent")}</strong><small>${esc(dateTime(snapshot.createdAt))} · ${esc(snapshot.actorEmail || "")}</small></span><button type="button" class="text-link" data-restore-snapshot="${esc(snapshot.id)}">Télécharger le JSON</button></li>`).join("") || '<li>Aucun état conservé avant restauration.</li>'}</ul>`;
      target.querySelectorAll("[data-restore-snapshot]").forEach(button=>button.addEventListener("click",async()=>{
        button.disabled=true;
        try {
          const snapshot=await api(`/restore/snapshots/${encodeURIComponent(button.dataset.restoreSnapshot)}`);
          const blob=new Blob([JSON.stringify(snapshot.state,null,2)],{type:"application/json"});
          const url=URL.createObjectURL(blob), link=document.createElement("a");
          link.href=url;link.download=`cap-sci-avant-restauration-${String(snapshot.createdAt || "").slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
          ctx.toast("L’état précédent a été téléchargé. Vérifiez-le avant de le restaurer.");
        } catch(e) {ctx.toast(e.message,true);} finally {button.disabled=false;}
      }));
    } catch(e) {if(content.isConnected) content.querySelector("#restore-state-list").textContent=e.message;}
  }
  async function loadOrphans(content,requested) {
    try {
      const data=await api("/storage/orphans");
      if(requested!==renderId || !content.isConnected) return;
      const target=content.querySelector("#orphan-documents");
      target.innerHTML=`<ul class="account-people">${(data.orphans || []).map(document=>`<li><span><strong>${esc(document.name)}</strong><small>${bytes(document.sizeBytes ?? document.size)} · ${esc(dateTime(document.createdAt))}</small></span><button type="button" class="text-link danger-text" data-orphan-kind="${esc(document.kind)}" data-orphan-id="${esc(document.id)}">Supprimer définitivement</button></li>`).join("") || '<li>Aucun document sans rattachement.</li>'}</ul>`;
      target.querySelectorAll("[data-orphan-id]").forEach(button=>button.addEventListener("click",()=>{
        ctx.confirmDialog("Supprimer définitivement ce document ?","Vérifiez que vous avez conservé une copie utile. Ce fichier ne pourra plus être récupéré depuis l’application.","Supprimer le fichier",async()=>{
          try {await api(`/storage/orphans/${encodeURIComponent(button.dataset.orphanKind)}/${encodeURIComponent(button.dataset.orphanId)}`,undefined,"DELETE");ctx.toast("Le document a été supprimé.");render("storage",content);}
          catch(e){ctx.toast(e.message,true);}
        });
      }));
    } catch(e) {if(content.isConnected)content.querySelector("#orphan-documents").textContent=e.message;}
  }
  function inviteForm() {
    if(!ctx.allowMutation()) return;
    const d=ctx.mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${ctx.formHeader("Inviter une personne","L’invitation est réservée à l’adresse indiquée. Vous gardez chacun votre mot de passe.","lock")}${ctx.field("email","Adresse e-mail à inviter *","","email",'required maxlength="254"')}<p class="finance-error" role="alert"></p>${ctx.formFooter("Créer le lien d’invitation")}</form></dialog>`);
    d.querySelector("form").addEventListener("submit",async e=>{
      e.preventDefault();const submit=d.querySelector('[type="submit"]');submit.disabled=true;
      try {
        const result=await api("/access/invitations",{email:d.querySelector('[name="email"]').value});
        ctx.closeDialog();if(activeContent?.isConnected) render("access",activeContent);showInvitation(result);
      } catch(error) {d.querySelector(".finance-error").textContent=error.message;} finally {submit.disabled=false;}
    });
  }
  function showInvitation(result) {
    const url=new URL(result.url,location.origin);
    const d=ctx.mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title">${ctx.formHeader("Le lien d’invitation est prêt",`Pour ${result.invitation.email}`,"lock")}<p class="account-explanation">Transmettez ce lien à la personne invitée. Elle devra utiliser cette adresse e-mail pour rejoindre votre SCI.</p><label class="account-link-label" for="invitation-link">Lien personnel d’invitation</label><input id="invitation-link" class="account-invitation-link" type="text" readonly value="${esc(url.href)}"><p class="form-note">Valable jusqu’au ${esc(dateTime(result.invitation.expiresAt))}. Conservez ce lien uniquement le temps de le transmettre.</p><p role="status" id="invitation-copy-status"></p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Fermer</button><button type="button" class="button primary" id="copy-invitation">Copier le lien</button></div></dialog>`);
    d.querySelector("#copy-invitation").addEventListener("click",async()=>{
      try {await navigator.clipboard.writeText(url.href);d.querySelector("#invitation-copy-status").textContent="Le lien a été copié.";}
      catch {const input=d.querySelector("#invitation-link");input.focus();input.select();d.querySelector("#invitation-copy-status").textContent="Copiez le lien sélectionné avec Ctrl+C ou le menu de votre appareil.";}
    });
  }
  function passwordForm() {
    if(!ctx.getUser() || !ctx.allowMutation())return;
    const d=ctx.mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${ctx.formHeader("Changer mon mot de passe","Ce changement concerne uniquement votre compte. Les autres sessions de ce compte seront déconnectées.","lock")}${ctx.field("currentPassword","Mot de passe actuel *","","password",'required autocomplete="current-password"')}${ctx.field("newPassword","Nouveau mot de passe *","","password",'required minlength="12" maxlength="128" autocomplete="new-password"')}${ctx.field("confirmation","Confirmer le nouveau mot de passe *","","password",'required minlength="12" maxlength="128" autocomplete="new-password"')}<p class="form-note">Choisissez entre 12 et 128 caractères.</p><p class="finance-error" role="alert"></p>${ctx.formFooter("Enregistrer le mot de passe")}</form></dialog>`);
    d.querySelector("form").addEventListener("submit",async e=>{
      e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));
      if(ctx.showErrors(d,{...(values.newPassword!==values.confirmation?{confirmation:"Les mots de passe ne correspondent pas."}:{})}))return;
      const submit=d.querySelector('[type="submit"]');submit.disabled=true;
      try {await api("/account/password",{currentPassword:values.currentPassword,newPassword:values.newPassword});ctx.closeDialog();ctx.toast("Votre mot de passe a été modifié.");}
      catch(error){d.querySelector(".finance-error").textContent=error.message;}
      finally{submit.disabled=false;}
    });
  }
  function action(name,id) {
    if(name==="invite-member"){inviteForm();return true;}
    if(name==="change-password"){passwordForm();return true;}
    if(name==="remove-member" || name==="revoke-invitation") {
      if(!ctx.allowMutation())return true;
      const member=name==="remove-member";
      ctx.confirmDialog(member?"Retirer cet accès ?":"Annuler cette invitation ?",member?"Cette personne ne pourra plus consulter cette SCI. Les données et l’historique restent conservés.":"Le lien d’invitation ne permettra plus de rejoindre la SCI.",member?"Retirer l’accès":"Annuler l’invitation",async()=>{
        try {await api(`/access/${member?"members":"invitations"}/${encodeURIComponent(id)}`,undefined,"DELETE");if(activeContent?.isConnected)render("access",activeContent);ctx.toast(member?"L’accès a été retiré.":"L’invitation a été annulée.");}
        catch(e){ctx.toast(e.message,true);}
      });return true;
    }
    return false;
  }
  return {render,action,passwordForm};
}
