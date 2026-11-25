import { configError, supabase, register, login, logout, getSession } from "./auth.js";
import { $, toast, showError } from "./ui.js";
import { tasksScreen } from "./tasks.js";
import { projectsScreen } from "./projects.js";

const state = { user: null };

/* ---------- Tabs and views ---------- */
const TABS = [
  { id: "home", label: "Home", icon: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  { id: "tasks", label: "Tasks", icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>' },
  { id: "projects", label: "Projects", icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' },
  { id: "memory", label: "Memory", icon: '<path d="M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3z"/><path d="M9.5 21h5"/>' },
  { id: "settings", label: "Settings", icon: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' },
];
const icon = (id) => TABS.find((t) => t.id === id).icon;
const chevron = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

const link = (id, text) => `
  <a class="row" href="#${id}">
    <svg class="ico" viewBox="0 0 24 24">${icon(id)}</svg>
    <div class="grow"><h3>${TABS.find((t) => t.id === id).label}</h3><span class="muted small">${text}</span></div>
    ${chevron}
  </a>`;

const soon = (title, text, stage) => `
  <h1>${title}</h1>
  <section class="glass card empty">
    <div class="orb"></div>
    <h2>Arrives in Stage ${stage}</h2>
    <p class="muted">${text}</p>
  </section>`;

const views = {
  home: () => `
    <h1>${greeting()}</h1>
    <section class="glass card command">
      <h2>What do you want to work on?</h2>
      <textarea id="command" placeholder="Describe a task, idea or project..."></textarea>
      <button class="btn primary wide" id="command-btn">Send</button>
      <p class="muted small" style="margin:12px 0 0">The AI core connects in Stage 4.</p>
    </section>
    <section class="glass rows">
      ${link("tasks", "Plan and finish your work")}
      ${link("projects", "Group your work into projects")}
      ${link("memory", "Keep what matters")}
    </section>`,
  memory: () => soon("Memory", "Save notes the AI can remember.", 3),
  settings: () => `
    <h1>Settings</h1>
    <section class="glass rows">
      <div class="row"><span class="grow">Account</span><span class="val" id="s-email"></span></div>
      <div class="row"><span class="grow">Connection</span><span class="val ok">Connected</span></div>
      <div class="row"><span class="grow">Version</span><span class="val">Stage 2</span></div>
    </section>
    <button class="btn secondary wide" id="logout-btn">Sign out</button>`,
};

// Screens that load their own data and render themselves.
const screens = { tasks: tasksScreen, projects: projectsScreen };

const mounts = {
  home() {
    $("#command-btn").addEventListener("click", () => {
      const text = $("#command").value.trim();
      toast(text ? "The AI core isn't connected yet." : "Type a task first.", text ? "info" : "error");
    });
  },
  settings() {
    $("#s-email").textContent = state.user?.email ?? "";
    $("#logout-btn").addEventListener("click", async () => {
      const { error } = await logout();
      if (error) toast(error.message, "error");
    });
  },
};

function renderTabs() {
  $("#tabbar").innerHTML = TABS.map(
    (t) => `<a class="tab" data-id="${t.id}" href="#${t.id}"><svg viewBox="0 0 24 24">${t.icon}</svg><span>${t.label}</span></a>`
  ).join("");
}

function route() {
  if (!state.user) return;
  const tab = TABS.find((t) => t.id === location.hash.slice(1)) ?? TABS[0];
  if (screens[tab.id]) {
    const root = document.createElement("div");
    $("#view").replaceChildren(root);
    screens[tab.id](root, state.user).catch(showError);
  } else {
    $("#view").innerHTML = views[tab.id]();
    mounts[tab.id]?.();
  }
  document.querySelectorAll(".tab").forEach((a) => {
    const on = a.dataset.id === tab.id;
    a.classList.toggle("on", on);
    on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  document.title = `${tab.label} · NEXUS ZERO`;
  window.scrollTo(0, 0);
}

/* ---------- Auth ---------- */
const authMsg = (text, isError = false) => {
  const el = $("#auth-message");
  el.textContent = text;
  el.classList.toggle("error", isError);
};
const setBusy = (busy) => document.querySelectorAll("#auth-form button, #auth-form input").forEach((el) => (el.disabled = busy));

async function submitAuth(kind) {
  const email = $("#email").value.trim();
  const password = $("#password").value;
  if (!email || password.length < 6) return authMsg("Enter your email and a password of at least 6 characters.", true);
  setBusy(true);
  authMsg(kind === "login" ? "Signing in..." : "Creating your account...");
  try {
    const { data, error } = kind === "login" ? await login(email, password) : await register(email, password);
    if (error) return authMsg(error.message, true);
    if (kind === "signup" && data.user?.identities?.length === 0) return authMsg("That email is already registered. Try signing in.", true);
    if (kind === "signup" && !data.session) return authMsg("Account created. Confirm it from the email we sent, then sign in.");
    authMsg("");
  } catch (err) {
    authMsg(err.message || "Something went wrong. Try again.", true);
  } finally {
    setBusy(false);
  }
}

function setSession(session) {
  const previous = state.user?.id;
  state.user = session?.user ?? null;
  $("#auth-view").hidden = !!state.user;
  $("#app-view").hidden = !state.user;
  if (!state.user) {
    $("#password").value = "";
  } else if (previous !== state.user.id) {
    route();
  }
}

/* ---------- Boot ---------- */
function updateNetwork() {
  const online = navigator.onLine;
  $("#net").classList.toggle("off", !online);
  $("#net span").textContent = online ? "Online" : "Offline";
}

async function init() {
  renderTabs();
  updateNetwork();
  window.addEventListener("online", updateNetwork);
  window.addEventListener("offline", updateNetwork);
  window.addEventListener("hashchange", route);

  $("#auth-form").addEventListener("submit", (e) => { e.preventDefault(); submitAuth("login"); });
  $("#signup-btn").addEventListener("click", () => submitAuth("signup"));

  if (configError) {
    $("#auth-view").hidden = false;
    setBusy(true);
    return authMsg(configError, true);
  }

  supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  const { data, error } = await getSession();
  if (error) authMsg(error.message, true);
  setSession(data?.session ?? null);
}

init().catch(showError);
