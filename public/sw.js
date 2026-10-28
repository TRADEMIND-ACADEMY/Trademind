/* Service worker TradeMind — cache des ressources statiques + page hors-ligne.
   Règles : réseau d'abord (toujours le code le plus récent en ligne) ; jamais de cache pour /api/* ni pour les requêtes non-GET ;
   hors ligne : ressources déjà visitées, sinon /offline.html. Aucune donnée de compte n'est mise en cache. */
const CACHE = "tm-static-v1";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/favicon.ico", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}); }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") return (await caches.match("/offline.html")) || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
      return new Response("", { status: 504 });
    }
  })());
});
