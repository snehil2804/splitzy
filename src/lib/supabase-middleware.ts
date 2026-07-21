import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routes reachable while signed out. Everything else redirects to `/login`.
 * `/api` is listed because API routes must answer 401 JSON themselves
 * (`/api/expenses` verifies the session cookie) — a login-page redirect is
 * the wrong response shape for a programmatic caller. `/join/<token>` must
 * also stay reachable signed-out — it shows the invite preview and the
 * sign-in CTA itself.
 *
 * `/offline` is public because it must be *precacheable* by the service
 * worker, and a redirect response cannot be cached at all (`cache.put()`
 * throws on one) — gating it meant the offline shell silently failed to
 * cache whenever the service worker installed before sign-in. Nothing is
 * lost by opening it: these pages render no server data whatsoever, read
 * only this device's IndexedDB (already scoped per authenticated user id),
 * and gate their own contents on identity — a signed-out visitor just sees
 * "Open Splitzy once while connected". When the device is genuinely
 * offline this proxy never runs anyway, so gating it was never the thing
 * protecting anything.
 */
const PUBLIC_PATHS = ["/login", "/auth", "/api", "/join", "/offline"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every matched request and gates
 * page access. Uses `getClaims()` (local JWT verification against Supabase's
 * published keys) rather than `getSession()`, which does not re-validate the
 * token — see Supabase's SSR guidance on why `getSession()` is unsafe here.
 *
 * Must create a fresh client per request (never module-level) — see the
 * Fluid-compute warning in Supabase's SSR docs about session leakage across
 * requests when a client is reused.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Unconfigured environments (e.g. a fresh checkout) fall through to the
  // app's existing SetupNotice screen instead of redirect-looping to /login.
  if (!url || !publishableKey) return supabaseResponse;

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  // Do not run code between createServerClient and getClaims() — see
  // Supabase's SSR docs on why that ordering matters for session refresh.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const pathname = request.nextUrl.pathname;

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}
