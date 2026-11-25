// Data layer. Every query is scoped to the signed-in user (user_id) and is also protected by RLS.
import { supabase } from "./auth.js";

export const PROJECT_STATUSES = ["active", "paused", "completed"];

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
const now = () => new Date().toISOString();

/* ---------- Projects ---------- */
export const listProjects = (uid) =>
  run(supabase.from("projects").select("*").eq("user_id", uid).order("created_at", { ascending: false }));

export const createProject = (uid, { name, description, status }) =>
  run(supabase.from("projects").insert({ user_id: uid, name, description: description ?? "", status }).select().single());

export const updateProject = (uid, id, patch) =>
  run(supabase.from("projects").update(patch).eq("id", id).eq("user_id", uid).select().single());

export async function deleteProject(uid, id) {
  // Keep the project's tasks: detach them first, whatever the foreign key does on delete.
  await run(supabase.from("tasks").update({ project_id: null, updated_at: now() }).eq("project_id", id).eq("user_id", uid));
  await run(supabase.from("projects").delete().eq("id", id).eq("user_id", uid));
}

/* ---------- Tasks ---------- */
export const listTasks = (uid) =>
  run(supabase.from("tasks").select("*").eq("user_id", uid).order("created_at", { ascending: false }));

export const createTask = (uid, { title, description, project_id }) =>
  run(supabase.from("tasks").insert({ user_id: uid, title, description: description ?? "", project_id: project_id || null }).select().single());

export const updateTask = (uid, id, patch) =>
  run(supabase.from("tasks").update({ ...patch, updated_at: now() }).eq("id", id).eq("user_id", uid).select().single());

export const deleteTask = (uid, id) =>
  run(supabase.from("tasks").delete().eq("id", id).eq("user_id", uid));

/* ---------- Memories ---------- */
export const listMemories = (uid) =>
  run(supabase.from("memories").select("*").eq("user_id", uid).order("created_at", { ascending: false }));

export const createMemory = (uid, { content, category, pinned }) =>
  run(supabase.from("memories").insert({ user_id: uid, content, category: category || null, pinned: !!pinned }).select().single());

export const updateMemory = (uid, id, patch) =>
  run(supabase.from("memories").update(patch).eq("id", id).eq("user_id", uid).select().single());

export const deleteMemory = (uid, id) =>
  run(supabase.from("memories").delete().eq("id", id).eq("user_id", uid));
