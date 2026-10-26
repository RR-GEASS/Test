import { uid, todayISO, money, moneyInput, shortDate, parseMoney, validDate, bankBalanceAt, validateBankCheck } from "./model.js";
import { icon, esc } from "./ui.js";

export function createBankCheckUI(ctx) {
  const { getState, allowMutation, mountDialog, closeDialog, field, formHeader, formFooter, showErrors, persist, confirmDialog } = ctx;
  const difference = (check) => {
    const calculated = bankBalanceAt(getState(), check.date);
    return calculated === null ? null : check.balanceCents - calculated;
  };
  function render(content) {
    const checks = [...(getState().bankChecks || [])].sort((a,b) => b.date.localeCompare(a.date));
    content.innerHTML = `<div class="notice">${icon("wallet")}<span>Comparez le solde de votre relevé au solde calculé par Cap SCI, à la même date. Ce contrôle convient à une SCI utilisant un seul compte bancaire. Il ne crée aucun mouvement.</span></div><section class="panel"><div class="panel-heading"><div><h2>Contrôles du solde bancaire</h2><p>L’écart correspond au solde du relevé moins le solde calculé.</p></div><button class="button secondary" data-action="add-bank-check">${icon("plus")}Comparer un solde</button></div>${checks.length ? `<div class="table-scroll finance-scroll" tabindex="0" role="region" aria-label="Contrôles bancaires"><table class="ledger"><thead><tr><th>Date du relevé</th><th>Solde du relevé</th><th>Solde calculé</th><th>Écart</th><th>Note</th><th>Actions</th></tr></thead><tbody>${checks.map(check => {
      const calculated = bankBalanceAt(getState(),check.date), delta = difference(check);
      return `<tr data-testid="bank-check-row"><td>${shortDate(check.date)}</td><td>${money(check.balanceCents)}</td><td>${calculated === null ? "Non disponible" : money(calculated)}</td><td><span class="status-pill ${delta === 0 ? "paid" : "pending"}">${delta === null ? "Date antérieure au solde initial" : delta === 0 ? "Concordant · 0,00 €" : `${money(delta)} · À vérifier`}</span></td><td>${esc(check.notes || "—")}</td><td><div class="point-actions"><button class="text-link" data-action="edit-bank-check" data-id="${esc(check.id)}">Modifier</button><button class="text-link danger-text" data-action="delete-bank-check" data-id="${esc(check.id)}">Supprimer</button></div></td></tr>`;
    }).join("")}</tbody></table></div>` : '<div class="empty-state"><h3>Votre premier contrôle bancaire</h3><p>Munissez-vous du solde de votre relevé, puis choisissez sa date.</p></div>'}</section><p class="form-note forecast-note">Le solde calculé est actualisé lorsque vous corrigez les opérations ou leurs règlements. Un écart nul ne garantit pas que chaque opération est correcte : vérifiez aussi les mouvements du relevé.</p>`;
  }
  function form(id) {
    if (!allowMutation()) return;
    const existing = (getState().bankChecks || []).find(c => c.id === id);
    const check = existing || {id:uid(), date:todayISO(), notes:""};
    const d = mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title"><form novalidate>${formHeader(existing ? "Modifier le contrôle bancaire" : "Comparer un solde bancaire", "Reprenez le solde de fin de journée indiqué sur votre relevé.", "wallet")}${field("date","Date du relevé *",check.date,"date","required")}${field("balance","Solde sur le relevé (€) *",existing ? moneyInput(check.balanceCents) : "","text",'inputmode="decimal" required')}<div class="payment-summary" id="bank-comparison" aria-live="polite"></div><div class="form-field"><label for="field-notes">Note</label><textarea name="notes" id="field-notes" rows="3" maxlength="3000">${esc(check.notes)}</textarea><span class="field-error" data-error="notes"></span></div>${formFooter("Enregistrer le contrôle")}</form></dialog>`);
    function preview() {
      const date = d.querySelector('[name="date"]').value;
      const balance = parseMoney(d.querySelector('[name="balance"]').value, true);
      const calculated = validDate(date) ? bankBalanceAt(getState(),date) : null;
      d.querySelector("#bank-comparison").textContent = calculated === null
        ? "Choisissez une date à partir de la date du solde initial."
        : `Solde calculé : ${money(calculated)}${balance === null ? "" : ` · Écart : ${money(balance-calculated)}`}`;
    }
    preview();
    d.querySelector("form").addEventListener("input",preview);
    d.querySelector("form").addEventListener("submit", e => {
      e.preventDefault();
      const result = validateBankCheck({...Object.fromEntries(new FormData(e.currentTarget)),id:check.id},getState());
      if (showErrors(d,result.errors)) return;
      const next = structuredClone(getState());
      next.bankChecks ||= [];
      if (existing) next.bankChecks = next.bankChecks.map(c => c.id === id ? result.value : c);
      else next.bankChecks.push(result.value);
      ctx.setState(next);
      closeDialog();
      persist("Le contrôle bancaire a été enregistré.");
    });
  }
  function action(action,id) {
    if (action === "add-bank-check" || action === "edit-bank-check") { form(id); return true; }
    if (action === "delete-bank-check") {
      if (allowMutation()) confirmDialog("Supprimer ce contrôle ?", "Le contrôle sera retiré de l’historique. Les opérations et règlements sont conservés.", "Supprimer le contrôle", () => {
        getState().bankChecks = (getState().bankChecks || []).filter(c => c.id !== id);
        persist("Le contrôle a été supprimé.");
      });
      return true;
    }
    return false;
  }
  return {render,action};
}
