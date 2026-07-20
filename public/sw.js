/**
 * Splitzy's offline shell service worker — hand-rolled, deliberately narrow
 * in scope. It exists to do exactly one thing: let the installed PWA open
 * into a usable Offline Mode when there's no network, after at least one
 * successful online visit. It never precaches or reasons about the full
 * app — only same-origin static assets and the two offline-shell routes.
 *
 * Explicitly out of scope, by design (see project offline-feature spec):
 *  - `/api/*` routes — always network-only, never cached.
 *  - Any cross-origin request (Supabase, Google Places, etc.) — the fetch
 *    handler bails out immediately for non-same-origin URLs, so these are
 *    never even inspected, let alone cached.
 *  - Non-GET requests — mutations always go straight to the network.
 */

const SHELL_CACHE = "splitzy-shell-v1";
const OFFLINE_SHELL_PATHS = ["/offline", "/offline/add"];

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Splitzy — Offline</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#0b0a12; color:#f2f0fa;
    display:flex; align-items:center; justify-content:center; min-height:100dvh; margin:0; padding:2rem; text-align:center; }
  div { max-width:22rem; }
  h1 { font-size:1.25rem; margin-bottom:0.5rem; }
  p { color:#a49dbb; font-size:0.9rem; line-height:1.5; }
</style>
</head>
<body>
  <div>
    <h1>You're offline</h1>
    <p>Open Splitzy once while connected to prepare Offline Mode.</p>
  </div>
</body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

function isCacheableStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/manifest.webmanifest"
  );
}

async function handleNavigate(request) {
  const pathname = new URL(request.url).pathname;
  try {
    const response = await fetch(request);
    if (response.ok && OFFLINE_SHELL_PATHS.includes(pathname)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    // Prefer the exact page requested (keeps a reload of the add form on
    // the add form instead of bouncing to the queue list); otherwise fall
    // back to the queue list; otherwise the app has never been opened
    // online and there's nothing cached to show.
    const exact = await cache.match(request);
    if (exact) return exact;
    const shell = await cache.match("/offline");
    if (shell) return shell;
    return new Response(FALLBACK_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function handleStaticAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Stale-while-revalidate: serve the cached copy immediately, refresh in
    // the background so assets don't stay stale forever across deploys.
    fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!isSameOrigin(request.url)) return;

  const pathname = new URL(request.url).pathname;
  if (isApiPath(pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request));
    return;
  }

  // The offline-shell routes are also warmed via a plain `fetch()` right
  // after a successful online session (see OfflineCacheWarmer) — that
  // request has mode "cors"/"same-origin", never "navigate", so it needs
  // its own cache-first-and-store handling here to actually take effect.
  if (OFFLINE_SHELL_PATHS.includes(pathname) || isCacheableStaticAsset(pathname)) {
    event.respondWith(handleStaticAsset(request));
  }
});
