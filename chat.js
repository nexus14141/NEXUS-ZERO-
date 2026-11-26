import { listConversations, listMessages, deleteConversation, sendMessage, createMemory, createTask } from "./db.js";
import { esc, formatText, toast, openSheet, closeSheet, armDelete } from "./ui.js";

const ARROW = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Kept while the app is open, so leaving and returning to Chat keeps your place.
let activeId = null;
let pending = null;

// Called from Home: opens Chat with a fresh conversation that starts with this text.
export function askAI(text) {
  pending = text;
  activeId = null;
  location.hash = "chat";
}

export async function chatScreen(root, user) {
  let messages = []; // { role, content, failed?, error? }
  let sending = false;

  root.innerHTML = `
    <div class="head"><h1>Chat</h1>
      <div class="head-actions">
        <button class="btn secondary compact" data-history>History</button>
        <button class="btn primary compact" data-new>New</button>
      </div>
    </div>
    <div class="thread" data-thread aria-live="polite"></div>
    <form class="composer glass" data-form>
      <textarea name="text" rows="1" maxlength="4000" placeholder="Message NEXUS ZERO" aria-label="Message"></textarea>
      <button class="send" aria-label="Send message">${ARROW}</button>
    </form>`;
  const thread = root.querySelector("[data-thread]");
  const form = root.querySelector("[data-form]");
  const input = form.elements.text;

  const actBtn = (m, kind, label) => `<button class="act" data-act="${kind}"${m.saved?.[kind] ? " disabled" : ""}>${m.saved?.[kind] ? "Saved" : label}</button>`;
  const bubble = (m, i) => `
    <div class="msg ${m.role}${m.failed ? " failed" : ""}" data-i="${i}">
      <div class="bubble">${m.role === "assistant" ? formatText(m.content) : esc(m.content)}</div>
      ${m.role === "assistant" ? `<div class="acts">${actBtn(m, "memory", "Save to memory")}${actBtn(m, "task", "Make task")}</div>` : ""}
      ${m.failed ? `<button class="retry" data-retry>${esc(m.error)} Tap to retry</button>` : ""}
    </div>`;

  function renderThread() {
    if (!root.isConnected) return;
    thread.innerHTML = messages.length || sending
      ? messages.map(bubble).join("") + (sending ? '<div class="msg assistant"><div class="bubble typing" aria-label="NEXUS ZERO is thinking"><i></i><i></i><i></i></div></div>' : "")
      : '<section class="glass card empty"><div class="orb"></div><h2>Ask anything</h2><p class="muted">Your pinned memories are shared with the AI, so it knows what matters to you.</p></section>';
    form.querySelector(".send").disabled = sending;
    if (messages.length) form.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  async function send(text, retrying) {
    if (sending) return;
    let m = retrying;
    if (m) m.failed = false;
    else {
      messages = messages.filter((x) => !x.failed); // an unsent message was never saved
      m = { role: "user", content: text };
      messages.push(m);
    }
    sending = true;
    renderThread();
    try {
      const out = await sendMessage(activeId, m.content);
      activeId = out.conversation_id;
      messages.push({ role: "assistant", content: out.reply });
    } catch (err) {
      m.failed = true;
      m.error = err.message;
    }
    sending = false;
    renderThread();
  }

  // Turns an AI reply into a memory or a task.
  async function saveFromReply(btn, m) {
    btn.disabled = true;
    try {
      if (btn.dataset.act === "memory") await createMemory(user.id, { content: m.content.slice(0, 2000), category: "From chat" });
      else {
        const first = m.content.split("\n").find((l) => l.trim()) ?? "";
        await createTask(user.id, { title: first.replace(/[*#`]/g, "").trim().slice(0, 120) || "Task from chat", description: m.content.slice(0, 4000) });
      }
      m.saved = { ...m.saved, [btn.dataset.act]: true };
      btn.textContent = "Saved";
      toast(btn.dataset.act === "memory" ? "Saved to memory" : "Task added");
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  }

  async function openConversation(id) {
    activeId = id;
    messages = [];
    renderThread();
    try {
      messages = (await listMessages(user.id, id)).map((r) => ({ role: r.role, content: r.content }));
    } catch (err) { toast(err.message, "error"); }
    renderThread();
  }

  async function showHistory() {
    const box = document.createElement("div");
    box.innerHTML = '<p class="muted">Loading...</p>';
    openSheet("History", box);
    try {
      const list = await listConversations(user.id);
      box.innerHTML = list.length
        ? `<div class="rows">${list.map((c) => `
            <div class="row" data-id="${esc(c.id)}">
              <button class="grow linkish" data-open><span class="title">${esc(c.title)}</span><span class="sub">${esc(shortDate(c.updated_at))}</span></button>
              <button class="btn danger compact" data-del>Delete</button>
            </div>`).join("")}</div>`
        : '<p class="muted">No conversations yet. Send a message to start one.</p>';
      box.querySelectorAll("[data-del]").forEach((btn) => armDelete(btn, "Delete", async () => {
        const row = btn.closest("[data-id]");
        try {
          await deleteConversation(user.id, row.dataset.id);
          if (row.dataset.id === activeId) { activeId = null; messages = []; renderThread(); }
          row.remove();
        } catch (err) { toast(err.message, "error"); }
      }));
    } catch (err) {
      box.innerHTML = `<p class="message error">${esc(err.message)}</p>`;
    }
    box.addEventListener("click", (e) => {
      const id = e.target.closest("[data-id]")?.dataset.id;
      if (id && e.target.closest("[data-open]")) { closeSheet(); openConversation(id); }
    });
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-history]")) return showHistory();
    if (e.target.closest("[data-new]")) { activeId = null; messages = []; return renderThread(); }
    const act = e.target.closest("[data-act]");
    if (act) return saveFromReply(act, messages[act.closest("[data-i]").dataset.i]);
    if (e.target.closest("[data-retry]")) return send(null, messages.find((m) => m.failed));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    input.value = "";
    input.style.height = "";
    send(text);
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
  input.addEventListener("keydown", (e) => {
    // On desktop Enter sends; on phones Enter adds a new line.
    if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) { e.preventDefault(); form.requestSubmit(); }
  });

  renderThread();
  if (pending) {
    const text = pending;
    pending = null;
    send(text);
  } else if (activeId) {
    openConversation(activeId);
  }
}
