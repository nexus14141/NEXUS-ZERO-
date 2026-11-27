import { logout, updatePassword } from "./auth.js";
import { exportAll, getAiUsage } from "./db.js";
import { toast, openSheet, closeSheet } from "./ui.js";

let installPrompt = null; // set when the browser offers to install the app
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });

const CHEVRON = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
const action = (id, title, sub) =>
  `<button class="row linkish" data-act="${id}"><span class="grow"><span class="title">${title}</span><span class="sub">${sub}</span></span>${CHEVRON}</button>`;

// Also opened automatically when someone arrives from a password-reset email.
export function changePassword() {
  const f = document.createElement("form");
  f.innerHTML = `
    <label for="f-pw">New password</label>
    <input id="f-pw" name="pw" type="password" autocomplete="new-password" minlength="6" required>
    <label for="f-pw2">Confirm password</label>
    <input id="f-pw2" name="pw2" type="password" autocomplete="new-password" minlength="6" required>
    <div class="stack"><button class="btn primary">Update password</button></div>
    <p class="message error" data-err></p>`;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = f.querySelector("[data-err]");
    const btn = f.querySelector(".primary");
    if (f.elements.pw.value !== f.elements.pw2.value) { note.textContent = "The passwords don't match."; return; }
    btn.disabled = true;
    try {
      const { error } = await updatePassword(f.elements.pw.value);
      if (error) throw error;
      closeSheet();
      toast("Password updated");
    } catch (err) {
      btn.disabled = false;
      note.textContent = err.message;
    }
  });
  openSheet("Change password", f);
}

async function exportData(user) {
  try {
    const data = { exported_at: new Date().toISOString(), ...(await exportAll(user.id)) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `nexus-zero-export-${data.exported_at.slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast("Export ready");
  } catch (err) { toast(err.message, "error"); }
}

export async function settingsScreen(root, user) {
  root.innerHTML = `
    <h1>Settings</h1>
    <section class="glass rows">
      <div class="row"><span class="grow">Account</span><span class="val" data-email></span></div>
      <div class="row"><span class="grow">AI requests today<span class="sub" data-ai-reset></span></span><span class="val" data-ai-usage>Checking...</span></div>
      <div class="row"><span class="grow">Version</span><span class="val">Stage 6.1</span></div>
    </section>
    <section class="glass rows">
      ${action("password", "Change password", "Choose a new one")}
      ${action("export", "Export my data", "Download everything as a file")}
      ${installPrompt ? action("install", "Install app", "Add NEXUS ZERO to your home screen") : ""}
    </section>
    <button class="btn secondary wide" data-act="logout">Sign out</button>`;
  root.querySelector("[data-email]").textContent = user.email ?? "";

  // Read-only: how many AI planning requests you have used today (the server does the counting).
  const usageEl = root.querySelector("[data-ai-usage]");
  const resetEl = root.querySelector("[data-ai-reset]");
  getAiUsage()
    .then((u) => {
      if (!root.isConnected) return;
      usageEl.textContent = u.ai_enabled ? `${u.used} of ${u.limit}` : "Switched off";
      if (u.ai_enabled) resetEl.textContent = "Resets at " + new Date(u.resets_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    })
    .catch(() => { if (root.isConnected) usageEl.textContent = "Unavailable"; });

  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const kind = el.dataset.act;
    if (kind === "password") changePassword();
    else if (kind === "export") exportData(user);
    else if (kind === "install" && installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      el.remove();
    } else if (kind === "logout") {
      const { error } = await logout();
      if (error) toast(error.message, "error");
    }
  });
}
