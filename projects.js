import { PROJECT_STATUSES, listProjects, listTasks, createProject, updateProject, deleteProject } from "./db.js";
import { esc, toast, openSheet, closeSheet, armDelete, skeleton } from "./ui.js";

const LABELS = { active: "Active", paused: "Paused", completed: "Completed" };
const label = (status) => LABELS[status] ?? status;
const FOLDER = '<svg class="ico" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

export async function projectsScreen(root, user) {
  let projects = [];
  let tasks = [];
  let loading = true;

  const row = (p) => {
    const mine = tasks.filter((t) => t.project_id === p.id);
    const open = mine.filter((t) => !t.completed).length;
    return `<button class="row linkish" data-id="${esc(p.id)}">${FOLDER}
      <span class="grow"><span class="title">${esc(p.name)}</span><span class="sub">${mine.length ? `${open} to do of ${mine.length}` : "No tasks yet"}</span></span>
      <span class="badge ${esc(p.status)}">${esc(label(p.status))}</span>
    </button>`;
  };

  function render() {
    if (!root.isConnected) return;
    root.innerHTML = `
      <div class="head"><h1>Projects</h1><button class="btn primary compact" data-add${loading ? " disabled" : ""}>New project</button></div>
      ${loading ? skeleton(3) : projects.length
        ? `<section class="glass rows">${projects.map(row).join("")}</section>`
        : `<section class="glass card empty"><h2>No projects yet</h2><p class="muted">Tap New project to create your first one.</p></section>`}`;
  }

  function edit(p) {
    const statuses = [...new Set([...PROJECT_STATUSES, p?.status].filter(Boolean))];
    const f = document.createElement("form");
    f.innerHTML = `
      <label for="f-name">Name</label>
      <input id="f-name" name="name" maxlength="120" required placeholder="Project name">
      <label for="f-desc">Description</label>
      <textarea id="f-desc" name="description" rows="3" placeholder="Optional"></textarea>
      <label for="f-status">Status</label>
      <select id="f-status" name="status">${statuses.map((s) => `<option value="${esc(s)}">${esc(label(s))}</option>`).join("")}</select>
      <div class="stack">
        <button class="btn primary">Save project</button>
        ${p ? '<button type="button" class="btn danger" data-del>Delete project</button>' : ""}
      </div>
      ${p ? '<p class="muted small" style="margin:12px 0 0">Deleting a project keeps its tasks. They become unassigned.</p>' : ""}
      <p class="message error" data-err></p>`;
    f.elements.name.value = p?.name ?? "";
    f.elements.description.value = p?.description ?? "";
    f.elements.status.value = p?.status ?? "active";
    const fail = (err) => { f.querySelector(".primary").disabled = false; f.querySelector("[data-err]").textContent = err.message; };

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      if (!v.name.trim()) return fail(new Error("Add a project name first."));
      f.querySelector(".primary").disabled = true;
      const fields = { name: v.name.trim(), description: v.description.trim(), status: v.status };
      try {
        if (p) Object.assign(p, await updateProject(user.id, p.id, fields));
        else projects.unshift(await createProject(user.id, fields));
        closeSheet();
        render();
        toast(p ? "Project saved" : "Project created");
      } catch (err) { fail(err); }
    });

    if (p) armDelete(f.querySelector("[data-del]"), "Delete project", async () => {
      try {
        await deleteProject(user.id, p.id);
        projects = projects.filter((x) => x !== p);
        tasks.forEach((t) => { if (t.project_id === p.id) t.project_id = null; });
        closeSheet();
        render();
        toast("Project deleted");
      } catch (err) { fail(err); }
    });
    openSheet(p ? "Edit project" : "New project", f);
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) return edit();
    const id = e.target.closest("[data-id]")?.dataset.id;
    const p = projects.find((x) => x.id === id);
    if (p) edit(p);
  });

  async function start() {
    loading = true;
    render();
    try {
      [projects, tasks] = await Promise.all([listProjects(user.id), listTasks(user.id)]);
      loading = false;
      render();
    } catch (err) {
      if (root.isConnected) root.innerHTML = `<h1>Projects</h1><section class="glass card empty"><h2>Couldn't load projects</h2><p class="muted">${esc(err.message)}</p><button class="btn secondary compact" data-reload>Try again</button></section>`;
    }
  }
  root.addEventListener("click", (e) => { if (e.target.closest("[data-reload]")) start(); });
  await start();
}
