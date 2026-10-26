import { fold, uid } from "./model.js";

// Keep the original select usable; the search field commits only an exact,
// unambiguous choice and stores the option ID through the normal change event.
export function assistEntityFields(root) {
  const names = new Set(["propertyId", "supplierId", "tenantId", "leaseId"]);
  function enhance() {
    root.querySelectorAll("select[name]").forEach(select => {
      if (!names.has(select.name) || select.dataset.assisted || select.disabled) return;
      select.dataset.assisted = "true";
      const label = [...root.querySelectorAll("label")].find(l => l.htmlFor === select.id)?.textContent || select.name;
      const input = document.createElement("input");
      input.type = "search";
      input.autocomplete = "off";
      input.placeholder = "Tapez un nom pour rechercher…";
      input.setAttribute("aria-label", `Rechercher : ${label.replace(/\s*\*$/, "")}`);
      const list = document.createElement("datalist");
      list.id = `choices-${uid()}`;
      input.setAttribute("list", list.id);
      input.className = "entity-search";
      select.before(input, list);
      const sync = () => {
        input.disabled = select.disabled;
        list.replaceChildren(...[...select.options].filter(o => o.value && !o.disabled).map(o => {
          const entry = document.createElement("option"); entry.value = o.textContent; return entry;
        }));
        if (document.activeElement !== input) input.value = select.value ? select.selectedOptions[0]?.textContent || "" : "";
      };
      input.addEventListener("input", () => {
        const matches = [...select.options].filter(o => o.value && fold(o.textContent) === fold(input.value));
        const next = matches.length === 1 ? matches[0].value : "";
        if (select.value !== next) { select.value = next; select.dispatchEvent(new Event("change", {bubbles:true})); }
      });
      input.addEventListener("blur", sync);
      select.addEventListener("change", sync);
      root.addEventListener("change", () => queueMicrotask(sync));
      new MutationObserver(sync).observe(select, {childList:true, subtree:true, attributes:true, attributeFilter:["disabled"]});
      sync();
    });
  }
  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(root, {childList:true, subtree:true});
  root.addEventListener("close", () => observer.disconnect(), {once:true});
}
