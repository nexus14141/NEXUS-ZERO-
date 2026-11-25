// Shared helpers: selector, toast, error display, safe escaping, bottom sheet, tap-twice delete.
export const $ = (selector, root = document) => root.querySelector(selector);

// Loads the Stage 2 styles (tasks, projects, bottom sheet).
document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "work.css" }));

// Escape user text before putting it inside an HTML string.
export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let toastTimer;
export function toast(message, type = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 3200);
}

// Shows errors on screen (handy on a phone, where there are no dev tools).
export function showError(err) {
  console.error(err);
  window.nxError?.(err?.message || String(err));
}

/* ---------- Bottom sheet ---------- */
function sheetEl() {
  let dialog = $("#sheet");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "sheet";
    dialog.innerHTML = '<div class="sheet-body"><h2></h2><div></div></div>';
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  return dialog;
}
export function openSheet(title, content) {
  const dialog = sheetEl();
  $("h2", dialog).textContent = title;
  $(".sheet-body > div", dialog).replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}
export const closeSheet = () => $("#sheet")?.close();

// A delete button that needs two taps: the first arms it, the second confirms.
export function armDelete(button, label, onConfirm) {
  let timer;
  button.addEventListener("click", () => {
    if (button.dataset.armed) {
      clearTimeout(timer);
      delete button.dataset.armed;
      button.textContent = label;
      return onConfirm();
    }
    button.dataset.armed = "1";
    button.textContent = "Tap again to confirm";
    timer = setTimeout(() => { delete button.dataset.armed; button.textContent = label; }, 3000);
  });
}
