import { esc } from "./ui.js";
import { shortDate } from "./model.js";

const types = {
  supplier: [ ["contrat", "Contrat fournisseur"], ["assurance", "Attestation d’assurance"], ["autre", "Autre document"] ],
  tenant: [ ["garant", "Document du garant"], ["autre", "Autre document personnel"] ],
  lease: [ ["bail", "Bail"], ["avenant", "Avenant"], ["etat_entree", "État des lieux d’entrée"], ["etat_sortie", "État des lieux de sortie"], ["assurance", "Assurance habitation"], ["autre", "Autre document de location"] ],
};
const collection = { supplier: "suppliers", tenant: "tenants", lease: "leases" };

export function createEntityDocumentsUI(ctx) {
  async function open(kind, id) {
    if (!Object.hasOwn(types, kind)) return;
    if (!ctx.getUser()) {
      ctx.toast("Créez un compte pour enregistrer vos documents.", true);
      return;
    }
    if (!ctx.allowMutation()) return;
    const state = ctx.getState();
    const entity = state[collection[kind]]?.find((row) => row.id === id);
    if (!entity) return;
    const title = kind === "lease"
      ? `${state.properties.find((p) => p.id === entity.propertyId)?.name || "Location"} · ${state.tenants.find((t) => t.id === entity.tenantId)?.name || "Locataire"}`
      : entity.name;
    const d = ctx.mountDialog(`<dialog class="form-dialog" aria-labelledby="dialog-title">${ctx.formHeader("Documents", title, "folder")}<div id="entity-document-list" aria-live="polite">Chargement…</div><div class="form-field"><label for="entity-document-type">Type de document</label><select id="entity-document-type">${types[kind].map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><div class="form-field"><label for="entity-document-files">Ajouter des documents</label><input id="entity-document-files" type="file" multiple accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"></div><p class="form-note">PDF, JPEG ou PNG · 5 Mo par fichier · 20 documents par fiche. L’espace de 50 Mo du compte est partagé avec les justificatifs des opérations.</p><p class="form-note">${kind === "tenant" ? "Ces documents personnels restent privés et ne sont pas ajoutés au dossier comptable." : kind === "lease" ? "Le bail et les avenants peuvent être inclus sur demande dans le dossier comptable. Les autres pièces restent dans cette fiche." : "Ces documents restent accessibles dans la fiche fournisseur. Joignez les factures aux opérations pour les transmettre au comptable."} Les fichiers ne sont pas contenus dans la sauvegarde JSON ; la sauvegarde complète du serveur les conserve.</p><p id="entity-doc-progress" role="status" aria-live="polite"></p><p class="finance-error" role="alert"></p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Fermer</button></div></dialog>`);
    const endpoint = `/api/entities/${kind}/${encodeURIComponent(id)}/documents`;
    const error = (message) => {
      if (d.isConnected) d.querySelector(".finance-error").textContent = message;
    };
    let busy = false;
    async function request(url, options = {}) {
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Le document n’a pas pu être enregistré.");
      return data;
    }
    async function list() {
      const data = await request(endpoint);
      if (!d.isConnected) return;
      d.querySelector("#entity-document-list").innerHTML = `<ul class="payment-list">${data.documents.map((document) => `<li><span><a href="/api/entity-documents/${encodeURIComponent(document.id)}" download>${esc(document.name)}</a><small>${esc(types[kind].find(([key]) => key === document.documentType)?.[1] || "Document")} · ${Math.ceil(document.size / 1024)} Ko · ${shortDate(document.createdAt.slice(0, 10))}</small><small>Original : ${esc(document.originalName)}</small></span><button type="button" class="text-link danger-text" data-delete-document="${esc(document.id)}">Supprimer</button></li>`).join("") || "<li>Aucun document pour cette fiche.</li>"}</ul>`;
      d.querySelectorAll("[data-delete-document]").forEach((button) => button.addEventListener("click", async () => {
        if (busy || !window.confirm("Supprimer définitivement ce document ?")) return;
        button.disabled = true;
        try {
          await request(`/api/entity-documents/${encodeURIComponent(button.dataset.deleteDocument)}`, { method: "DELETE" });
          await list();
          error("");
        } catch (e) { error(e.message); button.disabled = false; }
      }));
    }
    d.querySelector("#entity-document-files").addEventListener("change", async (event) => {
      if (busy) return;
      const input = event.currentTarget;
      const files = [...input.files];
      if (!files.length) return;
      const type = d.querySelector("#entity-document-type");
      const documentType = type.value;
      busy = true;
      input.disabled = type.disabled = true;
      const failures = [];
      let succeeded = 0;
      error("");
      try {
        for (const [index, file] of files.entries()) {
          if (!d.isConnected) break;
          d.querySelector("#entity-doc-progress").textContent = `Envoi ${index + 1} / ${files.length} : ${file.name}`;
          try {
            if (file.size > 5 * 1024 * 1024) throw new Error("Le document dépasse 5 Mo.");
            await request(endpoint, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-Document-Type": documentType }, body: file });
            succeeded++;
          } catch (e) { failures.push(`${file.name} : ${e.message}`); }
        }
        await list();
      } catch (e) { failures.push(e.message); }
      finally {
        busy = false;
        if (d.isConnected) {
          input.disabled = type.disabled = false;
          input.value = "";
          d.querySelector("#entity-doc-progress").textContent = `${succeeded} document${succeeded > 1 ? "s" : ""} enregistré${succeeded > 1 ? "s" : ""}.`;
          error(failures.join(" "));
        }
      }
    });
    try { await list(); } catch (e) { error(e.message); }
  }
  return { open };
}
