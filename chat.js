import { listConversations, listProjects, listMessages, deleteConversation, streamMessage, createMemory, createTask } from "./db.js";
import { esc, formatText, toast, openSheet, closeSheet, armDelete, skeleton, skeletonBubbles } from "./ui.js";

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

// Called on sign-out so the next person never sees this conversation.
export function resetChat() {
  activeId = null;
  pending = null;
}

export async function chatScreen(root, user) {
  let messages = []; // { role, content, failed?, error? }
  let sending = false;
  let loading = false;
  let epoch = 0; // bumped when you start or open another chat, so late replies are ignored

  root.innerHTML = `
    <div class="head"><h1>Chat</h1>
      <div class="head-actions">
        <button class="btn secondary compact" data-history>History</button>
        <button class="btn primary compact" data-new>New</button>
      </div>
    </div>
    <div class="thread" data-thread></div>
    <p class="sr-only" role="status" data-status></p>
    <form class="composer glass" data-form>
      <textarea name="text" rows="1" maxlength="4000" placeholder="Message NEXUS ZERO" aria-label="Message"></textarea>
      <button class="send" aria-label="Send message">${ARROW}</button>
    </form>`;
  const thread = root.querySelector("[data-thread]");
  const form = root.querySelector("[data-form]");
  const input = form.elements.text;
  const say = (text) => { root.querySelector("[data-status]").textContent = text; }; // announced to screen readers

  // A task or memory the AI suggests. It is only created when you tap Add.
  const proposal = (a, i) => {
    if (a.state === "dismissed") return "";
    const lines = a.type === "task"
      ? (a.project ? `<span class="sub">Project: ${esc(a.project)}</span>` : "") + (a.notes ? `<span class="sub">${esc(a.notes)}</span>` : "")
      : (a.category ? `<span class="sub">Category: ${esc(a.category)}</span>` : "");
    return `<div class="proposal" data-a="${i}">
      <div class="grow"><b class="tag">${a.type === "task" ? "Task" : "Memory"}</b><span class="title">${esc(a.type === "task" ? a.title : a.content)}</span>${lines}</div>
      ${a.state === "applied" ? '<span class="applied">Added</span>' : '<button class="btn primary compact" data-apply>Add</button><button class="act" data-dismiss>Dismiss</button>'}
    </div>`;
  };
  const actBtn = (m, kind, label) => `<button class="act" data-act="${kind}"${m.saved?.[kind] ? " disabled" : ""}>${m.saved?.[kind] ? "Saved" : label}</button>`;
  const bubble = (m, i) => `
    <div class="msg ${m.role}${m.failed ? " failed" : ""}" data-i="${i}">
      <div class="bubble">${m.role === "assistant" ? formatText(m.content) : esc(m.content)}</div>
      ${m.role === "assistant" && !m.streaming ? `<div class="acts">${actBtn(m, "memory", "Save to memory")}${actBtn(m, "task", "Make task")}</div>` : ""}
      ${m.actions && !m.streaming ? `<div class="proposals">${m.actions.map(proposal).join("")}</div>` : ""}
      ${m.failed ? `<button class="retry" data-retry>${esc(m.error)} Tap to retry</button>` : ""}
    </div>`;

  function renderThread() {
    if (!root.isConnected) return;
    thread.innerHTML = loading ? skeletonBubbles() : messages.length || sending
      ? messages.map(bubble).join("") + (sending && messages.at(-1)?.role !== "assistant" ? '<div class="msg assistant"><div class="bubble typing" aria-hidden="true"><i></i><i></i><i></i></div></div>' : "")
      : '<section class="glass card empty"><div class="orb"></div><h2>Ask anything</h2><p class="muted">Your pinned memories are shared with the AI, so it knows what matters to you.</p></section>';
    form.querySelector(".send").disabled = sending;
    if (messages.length && !loading) form.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
    const mine = epoch;
    const reply = { role: "assistant", content: "", streaming: true };
    say("NEXUS ZERO is thinking");
    renderThread();
    try {
      const out = await streamMessage(activeId, m.content, (delta) => {
        if (mine !== epoch) return;
        if (!reply.content) { messages.push(reply); reply.content = delta; renderThread(); return; } // first words replace the dots
        reply.content += delta;
        const nearBottom = innerHeight + scrollY >= document.body.scrollHeight - 160;
        const bubbleEl = thread.querySelector(".msg.assistant:last-child .bubble");
        if (bubbleEl) bubbleEl.innerHTML = formatText(reply.content);
        if (nearBottom) form.scrollIntoView({ block: "end" });
      }, (actions) => {
        if (mine === epoch) reply.actions = actions.map((a) => ({ ...a, state: "pending" }));
      });
      if (mine !== epoch) return; // you moved to another chat; this one is saved in History
      activeId = out.conversation_id;
      reply.streaming = false;
      say("New reply from NEXUS ZERO");
    } catch (err) {
      if (mine !== epoch) return;
      messages = messages.filter((x) => x !== reply); // a partial reply was never saved
      m.failed = true;
      m.error = err.message;
      say(err.message);
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

  async function applyProposal(m, i, card, btn) {
    const a = m.actions[i];
    if (a.state !== "pending") return;
    btn.disabled = true;
    try {
      if (a.type === "task") {
        const match = a.project ? (await listProjects(user.id)).find((p) => p.name.trim().toLowerCase() === a.project.toLowerCase()) : null;
        await createTask(user.id, { title: a.title, description: a.notes, project_id: match?.id ?? null });
      } else {
        await createMemory(user.id, { content: a.content, category: a.category || "From chat" });
      }
      a.state = "applied";
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
      return;
    }
    card.outerHTML = proposal(a, i);
    toast(a.type === "task" ? "Task added" : "Saved to memory");
  }

  async function openConversation(id) {
    const mine = ++epoch;
    sending = false;
    activeId = id;
    messages = [];
    loading = true;
    renderThread();
    try {
      const rows = await listMessages(user.id, id);
      if (mine === epoch) messages = rows.map((r) => ({ role: r.role, content: r.content }));
    } catch (err) { if (mine === epoch) toast(err.message, "error"); }
    if (mine !== epoch) return;
    loading = false;
    renderThread();
  }

  async function showHistory() {
    const box = document.createElement("div");
    box.innerHTML = skeleton(3);
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
      box.insertAdjacentHTML("beforeend", '<p class="message error" data-hist-err></p>');
      box.querySelectorAll("[data-del]").forEach((btn) => armDelete(btn, "Delete", async () => {
        const row = btn.closest("[data-id]");
        try {
          await deleteConversation(user.id, row.dataset.id);
          if (row.dataset.id === activeId) { epoch++; sending = false; loading = false; activeId = null; messages = []; renderThread(); }
          row.remove();
        } catch (err) { box.querySelector("[data-hist-err]").textContent = err.message; }
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
    if (e.target.closest("[data-new]")) { epoch++; sending = false; loading = false; activeId = null; messages = []; return renderThread(); }
    const card = e.target.closest("[data-a]");
    if (card) {
      const m = messages[card.closest("[data-i]").dataset.i];
      const i = Number(card.dataset.a);
      if (e.target.closest("[data-apply]")) return applyProposal(m, i, card, e.target.closest("[data-apply]"));
      if (e.target.closest("[data-dismiss]")) { m.actions[i].state = "dismissed"; return card.remove(); }
    }
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
