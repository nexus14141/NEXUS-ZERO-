import { listTasks, listProjects, createTask, updateTask, deleteTask } from "./db.js";
import { esc, toast, openSheet, closeSheet, armDelete, skeleton } from "./ui.js";

const FILTERS = [["open", "To do"], ["done", "Done"], ["all", "All"]];
let filter = "open"; // remembered while the app stays open

export async function tasksScreen(root, user) {
  let tasks = [];
  let projects = [];
  let loading = true;
  const projectName = (id) => projects.find((p) => p.id === id)?.name;

  const row = (t) => {
    const name = projectName(t.project_id);
    return `<div class="row task${t.completed ? " done" : ""}" data-id="${esc(t.id)}">
      <button class="check" data-check aria-pressed="${t.completed}" aria-label="${esc("Completed: " + t.title)}"></button>
      <button class="grow linkish" data-edit><span class="title">${esc(t.title)}</span>${name ? `<span class="sub">${esc(name)}</span>` : ""}</button>
    </div>`;
  };

  function render() {
    if (!root.isConnected) return;
    const shown = tasks.filter((t) => filter === "all" || (filter === "done") === t.completed);
    root.innerHTML = `
      <div class="head"><h1>Tasks</h1><button class="btn primary compact" data-add${loading ? " disabled" : ""}>New task</button></div>
      <div class="chips">${FILTERS.map(([id, label]) => `<button class="chip${id === filter ? " on" : ""}" data-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("")}</div>
      ${loading ? skeleton(4) : shown.length
        ? `<section class="glass rows">${shown.map(row).join("")}</section>`
        : `<section class="glass card empty"><h2>No tasks here</h2><p class="muted">Tap New task to add one.</p></section>`}`;
  }

  async function toggle(t) {
    const before = t.completed;
    t.completed = !before; // update the screen first, then save
    render();
    try {
      Object.assign(t, await updateTask(user.id, t.id, { completed: t.completed }));
    } catch (err) {
      t.completed = before;
      toast(err.message, "error");
    }
    render();
  }

  function edit(t) {
    const f = document.createElement("form");
    f.innerHTML = `
      <label for="f-title">Title</label>
      <input id="f-title" name="title" maxlength="200" required placeholder="What needs doing?">
      <label for="f-desc">Notes</label>
      <textarea id="f-desc" name="description" rows="3" placeholder="Optional"></textarea>
      <label for="f-proj">Project</label>
      <select id="f-proj" name="project_id"><option value="">No project</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
      <div class="stack">
        <button class="btn primary">Save task</button>
        ${t ? '<button type="button" class="btn danger" data-del>Delete task</button>' : ""}
      </div>
      <p class="message error" data-err></p>`;
    f.elements.title.value = t?.title ?? "";
    f.elements.description.value = t?.description ?? "";
    f.elements.project_id.value = t?.project_id ?? "";
    const fail = (err) => { f.querySelector(".primary").disabled = false; f.querySelector("[data-err]").textContent = err.message; };

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      if (!v.title.trim()) return fail(new Error("Add a title first."));
      f.querySelector(".primary").disabled = true;
      const fields = { title: v.title.trim(), description: v.description.trim(), project_id: v.project_id || null };
      try {
        if (t) Object.assign(t, await updateTask(user.id, t.id, fields));
        else tasks.unshift(await createTask(user.id, fields));
        closeSheet();
        render();
        toast(t ? "Task saved" : "Task added");
      } catch (err) { fail(err); }
    });

    if (t) armDelete(f.querySelector("[data-del]"), "Delete task", async () => {
      try {
        await deleteTask(user.id, t.id);
        tasks = tasks.filter((x) => x !== t);
        closeSheet();
        render();
        toast("Task deleted");
      } catch (err) { fail(err); }
    });
    openSheet(t ? "Edit task" : "New task", f);
  }

  root.addEventListener("click", (e) => {
    const t = tasks.find((x) => x.id === e.target.closest("[data-id]")?.dataset.id);
    const chip = e.target.closest("[data-filter]");
    if (e.target.closest("[data-add]")) return edit();
    if (chip) { filter = chip.dataset.filter; return render(); }
    if (t && e.target.closest("[data-check]")) return toggle(t);
    if (t && e.target.closest("[data-edit]")) return edit(t);
  });

  async function start() {
    loading = true;
    render();
    try {
      [tasks, projects] = await Promise.all([listTasks(user.id), listProjects(user.id)]);
      loading = false;
      render();
    } catch (err) {
      if (root.isConnected) root.innerHTML = `<h1>Tasks</h1><section class="glass card empty"><h2>Couldn't load tasks</h2><p class="muted">${esc(err.message)}</p><button class="btn secondary compact" data-reload>Try again</button></section>`;
    }
  }
  root.addEventListener("click", (e) => { if (e.target.closest("[data-reload]")) start(); });
  await start();
}
