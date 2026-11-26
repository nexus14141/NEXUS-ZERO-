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
    dialog.setAttribute("aria-labelledby", "sheet-title");
    dialog.innerHTML = '<div class="sheet-body"><h2 id="sheet-title"></h2><div></div></div>';
    // Close on a backdrop tap, but not when a drag that started inside the sheet ends outside it.
    let downOnBackdrop = false;
    dialog.addEventListener("pointerdown", (e) => { downOnBackdrop = e.target === dialog; });
    dialog.addEventListener("click", (e) => { if (e.target === dialog && downOnBackdrop) dialog.close(); });
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

// Safe light formatting for AI replies: text is escaped first, then only **bold**, `code`,
// ``` code blocks ```, "- " lists and paragraphs are turned into HTML.
export function formatText(text) {
  const blocks = [];
  let s = esc(text).replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code) - 1}\u0000`);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.split(/\n{2,}/).map((p) => {
    const lines = p.trim().split("\n");
    if (/^\u0000\d+\u0000$/.test(p.trim())) return p.trim();
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${l.replace(/^\s*[-*]\s+/, "")}</li>`).join("")}</ul>`;
    return `<p>${lines.join("<br>")}</p>`;
  }).join("");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><code>${blocks[i]}</code></pre>`);
}

// Loading placeholders sized like real rows and bubbles, so nothing jumps when data arrives.
export const skeleton = (rows = 4) =>
  `<section class="glass rows" aria-hidden="true">${'<div class="row"><i class="sk sk-dot"></i><div class="grow"><i class="sk sk-line"></i><i class="sk sk-line short"></i></div></div>'.repeat(rows)}</section>`;
export const skeletonBubbles = () =>
  '<div class="msg assistant" aria-hidden="true"><div class="bubble"><i class="sk sk-line"></i><i class="sk sk-line short"></i></div></div>'.repeat(2);
