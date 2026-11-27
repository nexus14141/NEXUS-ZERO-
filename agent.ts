// NEXUS ZERO AI gateway (Stage 6.2): Supabase Edge Function named "nexus-agent".
// Secret you add in Supabase (never in GitHub): AI_API_KEY.
// Optional secrets: AI_MODEL, AI_URL (to switch provider or model without changing this file).
// Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY automatically.
import { createClient } from "npm:@supabase/supabase-js@2";

const AI_URL = Deno.env.get("AI_URL") || "https://api.groq.com/openai/v1/chat/completions";
const AI_MODEL = Deno.env.get("AI_MODEL") || "llama-3.1-8b-instant";
const MAX_MESSAGE = 1500; // characters the user can send
const HISTORY = 6; // earlier messages sent along (keeps free-plan token use low)
const MAX_OUTPUT = 500; // tokens the AI may write
const TIMEOUT_MS = 40_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEM = "You are NEXUS ZERO, a calm, capable personal assistant. Be concise and clear. Use plain text and short paragraphs; avoid tables and heavy formatting.";

const CORS = {
  "Access-Control-Allow-Origin": "https://nexus14141.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// What the user sees when the usage guard says no.
const REASONS: Record<string, string> = {
  disabled: "The AI is switched off right now.",
  paused: "The AI is busy right now. Try again in a few minutes.",
  user_limit: "You've used all your AI requests for today. They reset at midnight UTC.",
  too_many_failures: "Too many failed attempts today. Try again after midnight UTC.",
  site_limit: "The AI is resting for today because many people used it. Try again tomorrow.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("NX_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const aiKey = Deno.env.get("AI_API_KEY");
  if (!url || !anonKey || !serviceKey || !aiKey) return json({ error: "The AI core is not set up yet." }, 500);

  const auth = req.headers.get("Authorization") ?? "";
  const db = createClient(url, anonKey, { global: { headers: { Authorization: auth } } }); // acts as the user, so RLS applies
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } }); // used ONLY for usage counting and the pause switch

  let userId = "";
  let reservationId: string | null = null;

  // Gives the request back (the AI failed), or does nothing if it was already settled.
  const release = async (reason: string) => {
    const id = reservationId;
    reservationId = null;
    if (!id) return;
    const { error } = await admin.rpc("ai_release", { p_id: id, p_user: userId, p_reason: reason });
    if (error) console.error("Release failed");
  };
  // Circuit breaker: when the provider says "too many requests", pause the AI for everyone for a while.
  const pause = async (retryAfter: string | null) => {
    const secs = Math.min(Math.max(Number(retryAfter) || 120, 60), 3600);
    await admin.from("ai_limits").update({ paused_until: new Date(Date.now() + secs * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", true);
  };

  try {
    // 1. Who is calling? (verified by Supabase Auth)
    const { data: { user }, error: authError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (authError || !user) return json({ error: "Please sign in again." }, 401);
    userId = user.id;

    // 2. Check the request. Bad requests never touch the daily quota.
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    let conversationId: string | null = body?.conversation_id ?? null;
    if (!message || message.length > MAX_MESSAGE) return json({ error: `Messages must be 1 to ${MAX_MESSAGE} characters.` }, 400);
    if (conversationId !== null && (typeof conversationId !== "string" || !UUID.test(conversationId))) return json({ error: "Invalid conversation." }, 400);
    const askedAt = new Date().toISOString();

    let history: { role: string; content: string }[] = [];
    if (conversationId) {
      const { data: convo } = await db.from("conversations").select("id").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
      if (!convo) return json({ error: "Conversation not found." }, 404);
      const { data: past } = await db.from("messages").select("role, content").eq("conversation_id", conversationId)
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(HISTORY);
      history = (past ?? []).reverse().filter((m) => m.role === "user" || m.role === "assistant");
    }

    // 3. Usage guard: reserve one request (the database does the counting, one at a time).
    const { data: gate, error: gateError } = await admin.rpc("ai_reserve", { p_user: user.id });
    if (gateError || !gate) { console.error("Reserve failed"); return json({ error: "The AI core is unavailable. Try again." }, 503); }
    if (!gate.ok) {
      const limited = gate.reason === "user_limit" || gate.reason === "too_many_failures";
      return json({ error: REASONS[gate.reason] ?? "The AI isn't available right now.", reason: gate.reason, resets_at: gate.resets_at ?? null }, limited ? 429 : 503);
    }
    reservationId = gate.reservation_id;

    // 4. Ask the AI provider (the key stays on the server).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let ai: Response;
    try {
      ai = await fetch(AI_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: AI_MODEL,
          stream: true,
          max_tokens: MAX_OUTPUT,
          messages: [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: message }],
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      console.error("Provider request failed:", (e as Error).name);
      await release((e as Error).name === "AbortError" ? "timeout" : "unreachable");
      return json({ error: "The AI service is unreachable. Try again." }, 504);
    }
    if (!ai.ok || !ai.body) {
      clearTimeout(timer);
      console.error("Provider returned status", ai.status);
      if (ai.status === 429) {
        await pause(ai.headers.get("retry-after"));
        await release("provider_rate_limited");
        return json({ error: REASONS.paused, reason: "paused" }, 503);
      }
      await release(`provider_${ai.status}`);
      return json({ error: "The AI service couldn't answer. Try again." }, 502);
    }

    // Saves the exchange (as the user, so RLS applies). Called only after a complete answer.
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

    // 5. Pass the words to the app as they arrive, then save and count.
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const stream = new ReadableStream({
      async start(c) {
        // If the app disconnects, keep going: the answer is still saved and counted, so leaving early is not a way around the limit.
        const send = (o: unknown) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* app left */ } };
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
          reply = reply.trim();
          if (!reply) throw new Error("empty");
          const id = await saveExchange(reply);
          const rid = reservationId;
          reservationId = null;
          const { data: counted } = await admin.rpc("ai_commit", { p_id: rid, p_user: user.id });
          if (!counted?.ok) console.error("Commit refused:", counted?.reason);
          send({ done: true, conversation_id: id });
        } catch (e) {
          const err = e as Error;
          console.error("Stream failed:", err.message);
          await release(err.message === "save" ? "save_failed" : err.name === "AbortError" ? "timeout" : "stream_failed");
          send({ error: err.message === "save" ? "Couldn't save the conversation." : err.name === "AbortError" ? "The AI took too long. Try again." : "The AI service couldn't answer. Try again." });
        } finally {
          clearTimeout(timer);
          try { c.close(); } catch { /* already closed */ }
        }
      },
    });
    return new Response(stream, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  } catch (e) {
    console.error("Unexpected error:", (e as Error).message);
    await release("unexpected");
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
