import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase-middleware";

/**
 * Next.js 16 renamed Middleware to Proxy (same file-convention rules: one
 * `proxy.ts`, exported as default or named `proxy`, alongside `app/`).
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets, image optimization, and the generated
    // favicon/icon/manifest routes — none of these are gated pages, and
    // redirecting them to /login would break the icon/manifest on that page.
    //
    // `sw.js` must be excluded for the same reason and then some: it is not
    // a page, and gating it meant a signed-out visitor's request for the
    // service worker answered 307 → /login, so registration failed outright
    // (a redirect to an HTML document is not a loadable worker script) and
    // that device got no offline shell at all. It only appeared to work
    // because registration normally happens while already signed in.
    "/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|sw\\.js).*)",
  ],
};
