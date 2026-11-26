// NEXUS ZERO service worker. Network first, so new uploads show up straight away;
// the cached copy is used only when you are offline. Supabase calls are never cached.
const CACHE = "nexus-zero-v1";
const SHELL = ["./", "index.html", "style.css", "work.css", "config.js", "auth.js", "db.js", "ui.js", "app.js",
  "tasks.js", "projects.js", "memory.js", "chat.js", "settings.js", "manifest.webmanifest", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const cacheable = url.origin === location.origin || url.hostname === "cdn.jsdelivr.net";
  if (e.request.method !== "GET" || !cacheable) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
