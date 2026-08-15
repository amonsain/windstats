/* ═══════════════════════════════════════════════════════════════
   WindStats — Service Worker
   • App shell précaché  → lancement instantané, fonctionne hors ligne
   • data/*.json         → réseau d'abord, cache en secours (données fraîches
                            si possible, dernières connues sinon)
   • polices Google      → cache d'abord, rafraîchi en arrière-plan
   • API live Pioupiou   → jamais interceptée (toujours le réseau)
   ═══════════════════════════════════════════════════════════════ */

const VERSION     = "v1";
const SHELL_CACHE = `windstats-shell-${VERSION}`;
const DATA_CACHE  = `windstats-data-${VERSION}`;
const FONT_CACHE  = `windstats-fonts-${VERSION}`;
const KEEP        = [SHELL_CACHE, DATA_CACHE, FONT_CACHE];

const SHELL = [
  "./",
  "./index.html",
  "./config.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll() échoue en bloc si une seule requête échoue : on tolère les trous.
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => null)
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => KEEP.includes(n) ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

// ── Stratégies ────────────────────────────────────────────────────

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    // rafraîchissement silencieux
    fetch(request).then(res => { if (res && res.ok) cache.put(request, res.clone()); })
                  .catch(() => {});
    return hit;
  }
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Mesures temps réel : toujours le réseau, jamais de cache.
  if (url.hostname === "api.pioupiou.fr") return;

  // Navigation (ouverture de l'appli) : réseau d'abord, shell en secours.
  if (req.mode === "navigate") {
    event.respondWith(
      networkFirst(req, SHELL_CACHE).catch(async () =>
        (await caches.match("./index.html")) || Response.error()
      )
    );
    return;
  }

  // Polices Google.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req, FONT_CACHE).catch(() => Response.error()));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Données agrégées : on veut les plus fraîches, sinon les dernières connues.
  if (url.pathname.includes("/data/")) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Reste du shell (html, js, icônes).
  event.respondWith(networkFirst(req, SHELL_CACHE));
});
