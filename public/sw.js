// Service worker: the app opens without a connection, and what the user already looked at can be read again.
//   shell   the app's own files. Network first, so a new version arrives as soon as there is a connection; the saved copy is the fallback.
//   data    this user's own answers (GET /api/...) and pictures. Network first with a timeout; the saved copy is used only when the network
//           fails, and is marked X-Smith-Offline so the app can say so. The app empties this cache on sign-out and on account deletion.
//   fonts   Google Fonts, saved after the first load, so Thai text keeps its look.
// Nothing is ever saved for a POST, PUT or DELETE, and an error answer (401, 403, 5xx) is never saved or served from the saved copies.
const SHELL = "smith-shell-v1";
const DATA = "smith-data-v1";
const FONTS = "smith-fonts-v1";
const FILES = ["/", "/app.js", "/app.css", "/icons.js", "/mascots.js", "/manifest.webmanifest", "/icon.svg", "/icon-180.png"];
const API_TIMEOUT_MS = 8000;

// Which cache strategy a request gets. Pure, so it can be tested without a browser.
function strategy(url, method, origin) {
  if (method !== "GET") return null;
  if (url.origin === origin) {
    if (url.pathname.startsWith("/api/")) return /^\/api\/(me|jobs(\/\d+)?|ledger)$/.test(url.pathname) ? "data" : null; // only the screens that can be read offline
    if (/^\/evidence\/|^\/logo\//.test(url.pathname)) return "pictures";
    if (url.pathname === "/sw.js") return null;
    return FILES.includes(url.pathname) ? "shell" : null;
  }
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ? "fonts" : null;
}

const withTimeout = (req, ms) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(req, { signal: ctl.signal }).finally(() => clearTimeout(timer));
};

// A copy of a saved answer that says it is saved.
function offlineCopy(res) {
  const headers = new Headers(res.headers);
  headers.set("X-Smith-Offline", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function networkFirst(req, cacheName, { timeout = 0, mark = false, ignoreSearch = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const res = timeout ? await withTimeout(req, timeout) : await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res; // an error answer goes to the app as it is
  } catch (err) {
    const saved = await cache.match(req, { ignoreSearch }); // "/?from=line" is still the app
    if (!saved) throw err;
    return mark ? offlineCopy(saved) : saved;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") await cache.put(req, res.clone()); // a font file seen with no-cors is opaque but fine to keep
  return res;
}

// A stylesheet from Google Fonts: the saved copy now, a fresh one saved for next time.
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(req);
  const fresh = fetch(req).then((res) => (res.ok || res.type === "opaque" ? cache.put(req, res.clone()).then(() => res) : res));
  if (saved) {
    fresh.catch(() => {});
    return saved;
  }
  return fresh;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const keep = [SHELL, DATA, FONTS];
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith("smith-") && !keep.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const how = strategy(new URL(req.url), req.method, self.location.origin);
  if (!how) return;
  event.respondWith(
    how === "shell" ? networkFirst(req, SHELL, { ignoreSearch: true })
      : how === "data" ? networkFirst(req, DATA, { timeout: API_TIMEOUT_MS, mark: true })
      : how === "pictures" ? cacheFirst(req, DATA)
      : req.url.includes("fonts.googleapis.com") ? staleWhileRevalidate(req, FONTS)
      : cacheFirst(req, FONTS),
  );
});
