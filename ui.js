// Small shared helpers.
export const $ = (selector, root = document) => root.querySelector(selector);

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
