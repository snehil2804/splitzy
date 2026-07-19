import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cookie-aware server client for Route Handlers / Server Components — reads
 * and refreshes the signed-in user's own session from request cookies, using
 * the publishable key. Not to be confused with `supabase-server.ts`, which
 * is the service_role admin client used only by `/api/expenses`.
 *
 * Must be created fresh per request (never cached in a module-level
 * variable) since it's bound to that request's cookie jar.
 */
export async function getSupabaseAuthServer() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch (err) {
          // Expected when called from a Server Component (can't set
          // cookies there) — proxy.ts refreshes the session on the next
          // request instead. Logged (not swallowed silently) so a genuine
          // failure in a Route Handler, where this must never throw, is
          // visible in server logs instead of masquerading as "it just
          // didn't work."
          console.error(
            "getSupabaseAuthServer: cookie write failed",
            err instanceof Error ? err.message : err,
          );
        }
      },
    },
  });
}
