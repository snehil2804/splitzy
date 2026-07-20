/**
 * Splitzy's offline shell service worker — hand-rolled, deliberately narrow
 * in scope. It exists to do exactly one thing: let the installed PWA open
 * into a usable Offline Mode when there's no network, after at least one
 * successful online visit.
 *
 * Explicitly out of scope, by design (see project offline-feature spec):
 *  - `/api/*` routes — always network-only, never cached.
 *  - Any cross-origin request (Supabase, Google Places, etc.) — the fetch
 *    handler bails out immediately for non-same-origin URLs, so these are
 *    never even inspected, let alone cached.
 *  - Non-GET requests — mutations always go straight to the network.
 *
 * IMPORTANT — why this precaches at install rather than opportunistically:
 * caching only the offline routes' HTML is not enough to make them *work*.
 * `/offline` and `/offline/add` are client components; their HTML renders a
 * "Loading…" placeholder and everything real happens after React hydrates.
 * If their JS chunks aren't also cached, the page loads and then sits on
 * "Loading…" forever with no network to fetch them from. The first version
 * of this file only stored chunks after they'd already been requested
 * *through* the service worker, which was far too fragile in practice
 * (confirmed on a real device: shell missing entirely, or present but
 * permanently stuck). So install now fetches each offline route, scrapes
 * the `/_next/static/*` script and stylesheet URLs out of its HTML, and
 * precaches those too — self-maintaining across builds, no build step and
 * no hardcoded content hashes.
 */

const SHELL_CACHE = "splitzy-shell-v2";
const OFFLINE_SHELL_PATHS = ["/offline", "/offline/add"];
const EXTRA_PRECACHE_PATHS = ["/manifest.webmanifest", "/icon", "/apple-icon"];

/**
 * Pulls `/_next/static/...` URLs out of a served HTML document. A regex
 * rather than DOMParser because DOMParser doesn't exist in a service worker
 * context; the shape of Next's emitted script/link tags is stable enough
 * for this, and anything missed still gets picked up by runtime caching.
 */
const ASSET_URL_RE = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;

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

/**
 * `cache.put()` throws outright on a redirected response — which is exactly
 * what a Vercel-SSO-protected preview deployment returns — and there's no
 * point storing a non-OK one. Caching is best-effort by nature: a failure
 * here (quota, opaque response, redirect) must never break the page.
 */
async function safePut(cache, request, response) {
  if (!response || !response.ok || response.redirected) return false;
  try {
    await cache.put(request, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const assetUrls = new Set();

  await Promise.all(
    OFFLINE_SHELL_PATHS.map(async (path) => {
      try {
        const response = await fetch(path, { credentials: "same-origin" });
        if (!response.ok || response.redirected) return;
        const html = await response.clone().text();
        await safePut(cache, path, response);
        for (const match of html.matchAll(ASSET_URL_RE)) {
          assetUrls.add(match[1]);
        }
      } catch {
        // Offline at install time — runtime caching and the client-side
        // warmer will fill this in on the next successful online load.
      }
    }),
  );

  await Promise.all(
    [...assetUrls, ...EXTRA_PRECACHE_PATHS].map(async (url) => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        await safePut(cache, url, response);
      } catch {
        // Individual asset failures are non-fatal by design.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().finally(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // Re-run precaching on activate as well: if install ran while the
      // device was offline (or a few assets failed), this heals the gap
      // without waiting for another deploy.
      await precacheShell();
    })(),
  );
});

/**
 * The client asks for a re-precache after every successful online load
 * (see `OfflineCacheWarmer`). This is what heals the case where install
 * ran at a moment the shell couldn't be fetched — offline, or before
 * sign-in back when `/offline` was still auth-gated and redirecting.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "precache-shell") {
    event.waitUntil(precacheShell());
  }
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
    EXTRA_PRECACHE_PATHS.includes(pathname)
  );
}

async function handleNavigate(request) {
  const pathname = new URL(request.url).pathname;
  try {
    const response = await fetch(request);
    if (OFFLINE_SHELL_PATHS.includes(pathname)) {
      const cache = await caches.open(SHELL_CACHE);
      await safePut(cache, request, response);
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    // Prefer the exact page requested (keeps a reload of the add form on
    // the add form instead of bouncing to the queue list); otherwise fall
    // back to the queue list. `ignoreSearch` so a query string (e.g. an
    // `?edit=` link, or a cache-busting param) still matches.
    const exact = await cache.match(request, { ignoreSearch: true });
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
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    // Stale-while-revalidate: serve the cached copy immediately, refresh in
    // the background so assets don't stay stale forever across deploys.
    fetch(request)
      .then((response) => safePut(cache, request, response))
      .catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    await safePut(cache, request, response);
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
