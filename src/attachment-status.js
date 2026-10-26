import { api } from "./api.js";
import { esc } from "./ui.js";

export function createAttachmentStatus({ getUser, getState = () => ({transactions: []}), onChange = () => {} }) {
  let ownerId = null;
  let counts = null;
  let pending = null;
  let generation = 0;

  function syncOwner() {
    const id = getUser()?.id || null;
    if (id !== ownerId) {
      ownerId = id;
      counts = null;
      pending = null;
      generation++;
    }
    return id;
  }
  const countFor = (id) => counts && Object.hasOwn(counts, id) ? counts[id] : 0;
  const notRequired = id => getState().transactions.find(t => t.id === id)?.documentNotRequired;
  function text(id) {
    if (notRequired(id) && !countFor(id)) return "Justificatif non nécessaire";
    if (!ownerId) return "Justificatifs : compte requis";
    if (!counts) return "Justificatifs : …";
    const count = countFor(id);
    return count ? `${count} justificatif${count > 1 ? "s" : ""}` : "Justificatif manquant";
  }
  function paint() {
    document.querySelectorAll("[data-document-status]").forEach((element) => {
      element.textContent = text(element.dataset.documentStatus);
      element.classList.toggle("missing-document", !!ownerId && !!counts && !notRequired(element.dataset.documentStatus) && !countFor(element.dataset.documentStatus));
    });
  }
  function html(id) {
    syncOwner();
    const missing = !!ownerId && !!counts && !notRequired(id) && !countFor(id);
    return `<small class="document-status${missing ? " missing-document" : ""}" data-document-status="${esc(id)}">${esc(text(id))}</small>`;
  }
  async function refresh() {
    if (!syncOwner()) { paint(); return; }
    if (pending) return pending;
    const requestedOwner = ownerId;
    const requestedGeneration = generation;
    const request = api("/attachments/summary").then((result) => {
      if (getUser()?.id !== requestedOwner || generation !== requestedGeneration) return;
      counts = result.counts;
      paint();
      onChange();
    }).catch(() => {
      // Keep the last known counts; never claim a document is missing on a failed read.
    }).finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return request;
  }
  function setCount(id, count) {
    syncOwner();
    generation++;
    if (counts) counts[id] = count;
    // If no complete summary has loaded, fetch one instead of guessing other counts.
    else { pending = null; refresh(); }
    paint();
    onChange();
  }
  function reset() {
    generation++;
    ownerId = getUser()?.id || null;
    counts = null;
    pending = null;
    paint();
  }
  return { html, refresh, setCount, reset, count: id => counts ? countFor(id) : null };
}
