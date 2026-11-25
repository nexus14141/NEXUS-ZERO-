import { listMemories, createMemory, updateMemory, deleteMemory } from "./db.js";
import { esc, toast, openSheet, closeSheet, armDelete } from "./ui.js";

const PIN = '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/></svg>';
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export async function memoryScreen(root, user) {
  let memories = [];
  let query = "";

  const row = (m) => `
    <div class="row memory" data-id="${esc(m.id)}">
      <button class="grow linkish" data-edit>
        <span class="mem-text">${esc(m.content)}</span>
        <span class="sub">${m.category ? `<b class="tag">${esc(m.category)}</b>` : ""}${esc(shortDate(m.created_at))}</span>
      </button>
      <button class="pin" data-pin aria-pressed="${m.pinned}" aria-label="${m.pinned ? "Unpin memory" : "Pin memory"}">${PIN}</button>
    </div>`;

  // Redraws only the list, so the search box keeps focus while you type.
  function renderList() {
    const box = root.querySelector("[data-list]");
    if (!box || !root.isConnected) return;
    const q = query.trim().toLowerCase();
    const shown = [...memories]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.created_at) - new Date(a.created_at))
      .filter((m) => !q || m.content.toLowerCase().includes(q) || (m.category ?? "").toLowerCase().includes(q));
    box.innerHTML = shown.length
      ? `<section class="glass rows">${shown.map(row).join("")}</section>`
      : memories.length
        ? '<section class="glass card empty"><h2>No matches</h2><p class="muted">Try a different word.</p></section>'
        : '<section class="glass card empty"><h2>Nothing saved yet</h2><p class="muted">Tap New memory to save something worth keeping.</p></section>';
  }

  function renderShell() {
    root.innerHTML = `
      <div class="head"><h1>Memory</h1><button class="btn primary compact" data-add>New memory</button></div>
      <input class="search" type="search" data-search placeholder="Search memories" aria-label="Search memories" autocomplete="off">
      <div data-list></div>`;
    renderList();
  }

  async function togglePin(m) {
    const before = m.pinned;
    m.pinned = !before; // update the screen first, then save
    renderList();
    try {
      Object.assign(m, await updateMemory(user.id, m.id, { pinned: m.pinned }));
    } catch (err) {
      m.pinned = before;
      toast(err.message, "error");
    }
    renderList();
  }

  function edit(m) {
    const categories = [...new Set(memories.map((x) => x.category).filter(Boolean))];
    const f = document.createElement("form");
    f.innerHTML = `
      <label for="f-content">Memory</label>
      <textarea id="f-content" name="content" rows="5" maxlength="2000" required placeholder="What should be remembered?"></textarea>
      <label for="f-cat">Category</label>
      <input id="f-cat" name="category" maxlength="40" list="f-cats" placeholder="Optional, e.g. Preferences">
      <datalist id="f-cats">${categories.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <div class="stack">
        <button class="btn primary">Save memory</button>
        ${m ? '<button type="button" class="btn danger" data-del>Delete memory</button>' : ""}
      </div>
      <p class="message error" data-err></p>`;
    f.elements.content.value = m?.content ?? "";
    f.elements.category.value = m?.category ?? "";
    const fail = (err) => { f.querySelector(".primary").disabled = false; f.querySelector("[data-err]").textContent = err.message; };

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      if (!v.content.trim()) return fail(new Error("Write something to remember first."));
      f.querySelector(".primary").disabled = true;
      const fields = { content: v.content.trim(), category: v.category.trim() || null };
      try {
        if (m) Object.assign(m, await updateMemory(user.id, m.id, fields));
        else memories.unshift(await createMemory(user.id, fields));
        closeSheet();
        renderList();
        toast("Memory saved");
      } catch (err) { fail(err); }
    });

    if (m) armDelete(f.querySelector("[data-del]"), "Delete memory", async () => {
      try {
        await deleteMemory(user.id, m.id);
        memories = memories.filter((x) => x !== m);
        closeSheet();
        renderList();
        toast("Memory deleted");
      } catch (err) { fail(err); }
    });
    openSheet(m ? "Edit memory" : "New memory", f);
  }

  root.addEventListener("click", (e) => {
    const m = memories.find((x) => x.id === e.target.closest("[data-id]")?.dataset.id);
    if (e.target.closest("[data-add]")) return edit();
    if (m && e.target.closest("[data-pin]")) return togglePin(m);
    if (m && e.target.closest("[data-edit]")) return edit(m);
  });
  root.addEventListener("input", (e) => {
    if (e.target.matches("[data-search]")) { query = e.target.value; renderList(); }
  });

  root.innerHTML = '<h1>Memory</h1><p class="muted">Loading...</p>';
  try {
    memories = await listMemories(user.id);
    renderShell();
  } catch (err) {
    if (root.isConnected) root.innerHTML = `<h1>Memory</h1><section class="glass card empty"><h2>Couldn't load memories</h2><p class="muted">${esc(err.message)}</p></section>`;
  }
}
