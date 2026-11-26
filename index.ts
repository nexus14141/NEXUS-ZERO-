// NEXUS ZERO AI core: Supabase Edge Function named "nexus-chat".
// Secrets (set in Supabase, never in GitHub): OPENROUTER_API_KEY. Optional: OPENROUTER_MODEL.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("OPENROUTER_MODEL") || "anthropic/claude-haiku-5.5";
const SITE = "https://nexus14141.github.io/NEXUS-ZERO-/";
const MAX_MESSAGE = 4000; // characters per user message
const HISTORY = 20; // earlier messages sent to the model
const TIMEOUT_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  "Access-Control-Allow-Origin": "https://nexus14141.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("NX_PUBLISHABLE_KEY");
    const aiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!url || !key || !aiKey) return json({ error: "The AI core is not set up yet." }, 500);

    // 1. Verify the caller's JWT with Supabase Auth. All database work runs as that user, so RLS applies.
    const auth = req.headers.get("Authorization") ?? "";
    const db = createClient(url, key, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (authError || !user) return json({ error: "Please sign in again." }, 401);

    // 2. Validate the payload.
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    let conversationId: string | null = body?.conversation_id ?? null;
    if (!message || message.length > MAX_MESSAGE) return json({ error: `Messages must be 1 to ${MAX_MESSAGE} characters.` }, 400);
    if (conversationId !== null && (typeof conversationId !== "string" || !UUID.test(conversationId))) {
      return json({ error: "Invalid conversation." }, 400);
    }
    const askedAt = new Date().toISOString();

    // Cost guard: at most 100 messages per user per hour.
    const { count } = await db.from("messages").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("role", "user").gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= 100) return json({ error: "You've reached the hourly message limit. Try again later." }, 429);

    // 3. Existing conversation: confirm it belongs to this user, then load recent history.
    let history: { role: string; content: string }[] = [];
    if (conversationId) {
      const { data: convo } = await db.from("conversations").select("id").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
      if (!convo) return json({ error: "Conversation not found." }, 404);
      const { data: past } = await db.from("messages").select("role, content").eq("conversation_id", conversationId)
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(HISTORY);
      history = (past ?? []).reverse().filter((m) => m.role === "user" || m.role === "assistant");
    }

    // 4. Pinned memories give the AI context about the user.
    const { data: memories } = await db.from("memories").select("content").eq("user_id", user.id).eq("pinned", true).limit(20);
    let system = "You are NEXUS ZERO, a calm, capable personal AI assistant. Be concise and clear. Use plain text and short paragraphs; avoid markdown tables and heavy formatting.";
    if (memories?.length) system += "\n\nThings the user has asked you to remember:\n" + memories.map((m) => `- ${String(m.content).slice(0, 500)}`).join("\n");

    // 5. Build the OpenRouter request (the key stays on the server).
    const payload = { model: MODEL, max_tokens: 1200, messages: [{ role: "system", content: system }, ...history, { role: "user", content: message }] };
    const streaming = body.stream === true;

    // Saves only after a complete answer, so a failed or retried request never leaves half a chat behind.
    const saveExchange = async (reply: string): Promise<string> => {
      let id = conversationId;
      if (!id) {
        const title = message.replace(/\s+/g, " ").slice(0, 60);
        const { data: created, error } = await db.from("conversations").insert({ user_id: user.id, title }).select("id").single();
        if (error || !created) throw new Error("save");
        id = created.id as string;
      } else {
        await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
      }
      const { error } = await db.from("messages").insert([
        { conversation_id: id, user_id: user.id, role: "user", content: message, created_at: askedAt },
        { conversation_id: id, user_id: user.id, role: "assistant", content: reply, created_at: new Date().toISOString() },
      ]);
      if (error) throw new Error("save");
      return id;
    };
    const failure = (e: Error) =>
      e.message === "save" ? "Couldn't save the conversation." : e.name === "AbortError" ? "The AI took too long. Try again." : "The AI service couldn't answer. Try again.";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let ai: Response;
    try {
      ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json", "HTTP-Referer": SITE, "X-Title": "NEXUS ZERO" },
        body: JSON.stringify(streaming ? { ...payload, stream: true } : payload),
      });
    } catch (e) {
      clearTimeout(timer);
      console.error("OpenRouter request failed:", (e as Error).name);
      return json({ error: failure(e as Error) }, 504);
    }
    if (!ai.ok || !ai.body) {
      clearTimeout(timer);
      console.error("OpenRouter returned status", ai.status);
      return json({ error: ai.status === 429 ? "The AI is busy. Try again in a moment." : "The AI service couldn't answer. Try again." }, 502);
    }

    // 6a. Streaming: pass the words to the app as they arrive, then save the exchange.
    if (streaming) {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const stream = new ReadableStream({
        async start(c) {
          const send = (o: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
          let reply = "";
          let buf = "";
          try {
            const reader = ai.body!.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line.startsWith("data:") || line.endsWith("[DONE]")) continue;
                let delta = "";
                try { delta = JSON.parse(line.slice(5))?.choices?.[0]?.delta?.content ?? ""; } catch { /* partial line */ }
                if (delta) { reply += delta; send({ delta }); }
              }
            }
            if (!reply.trim()) throw new Error("empty");
            send({ done: true, conversation_id: await saveExchange(reply.trim()) });
          } catch (e) {
            console.error("Stream failed:", (e as Error).message);
            try { send({ error: failure(e as Error) }); } catch { /* the app disconnected */ }
          } finally {
            clearTimeout(timer);
            try { c.close(); } catch { /* already closed */ }
          }
        },
      });
      return new Response(stream, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }

    // 6b. Not streaming: wait for the whole answer.
    const result = await ai.json().catch(() => null);
    clearTimeout(timer);
    const reply = String(result?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return json({ error: "The AI returned an empty answer. Try again." }, 502);
    try {
      return json({ conversation_id: await saveExchange(reply), reply });
    } catch {
      return json({ error: "Couldn't save the conversation." }, 500);
    }
  } catch (e) {
    console.error("Unexpected error:", (e as Error).message);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
