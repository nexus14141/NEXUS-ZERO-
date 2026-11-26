// Data layer. Every query is scoped to the signed-in user (user_id) and is also protected by RLS.
import { supabase } from "./auth.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const PROJECT_STATUSES = ["active", "paused", "completed"];

async function run(query) {
  const { data, error } = await query;
  if (error) throw /failed to fetch|networkerror|load failed/i.test(error.message) ? new Error("Can't reach the server. Check your connection.") : error;
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

/* ---------- Conversations and messages ---------- */
export const listConversations = (uid) =>
  run(supabase.from("conversations").select("id, title, updated_at").eq("user_id", uid).order("updated_at", { ascending: false }).limit(50));

export const listMessages = (uid, conversationId) =>
  run(supabase.from("messages").select("*").eq("user_id", uid).eq("conversation_id", conversationId).order("created_at", { ascending: true }));

export async function deleteConversation(uid, id) {
  await run(supabase.from("messages").delete().eq("conversation_id", id).eq("user_id", uid));
  await run(supabase.from("conversations").delete().eq("id", id).eq("user_id", uid));
}

// Sends a message to the Edge Function. It creates the conversation on the first message.
export async function sendMessage(conversationId, message) {
  const { data, error } = await supabase.functions.invoke("nexus-chat", { body: { conversation_id: conversationId, message } });
  if (error) {
    if (error.name === "FunctionsFetchError") throw new Error("Can't reach the AI. Check your connection.");
    let text = "The AI core couldn't answer. Try again.";
    try { text = (await error.context.json()).error || text; } catch { /* keep the default */ }
    throw new Error(text);
  }
  return data; // { conversation_id, reply }
}

/* ---------- Export ---------- */
export async function exportAll(uid) {
  const all = (table) => run(supabase.from(table).select("*").eq("user_id", uid));
  const [projects, tasks, memories, conversations, messages] = await Promise.all(
    ["projects", "tasks", "memories", "conversations", "messages"].map(all)
  );
  return { projects, tasks, memories, conversations, messages };
}

// Streams the AI's answer. onDelta(text) is called as words arrive; resolves with { conversation_id }.
export async function streamMessage(conversationId, message, onDelta, onActions) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again.");
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/nexus-chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, message, stream: true }),
    });
  } catch {
    throw new Error("Can't reach the AI. Check your connection.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.includes("application/json")) { // an older function that doesn't stream
    const out = await res.json();
    onDelta(out.reply);
    return out;
  }
  if (!res.ok || !type.includes("text/event-stream")) {
    let text = "The AI core couldn't answer. Try again.";
    try { text = (await res.json()).error || text; } catch { /* keep the default */ }
    throw new Error(text);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 2);
      if (!line.startsWith("data:")) continue;
      let event;
      try { event = JSON.parse(line.slice(5)); } catch { continue; }
      if (event.error) throw new Error(event.error);
      if (event.delta) onDelta(event.delta);
      if (event.actions) onActions?.(event.actions);
      if (event.done) result = event;
    }
  }
  if (!result) throw new Error("The connection dropped before the reply finished. Try again.");
  return result;
}
