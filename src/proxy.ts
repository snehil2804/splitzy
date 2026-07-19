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
    "/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest).*)",
  ],
};
