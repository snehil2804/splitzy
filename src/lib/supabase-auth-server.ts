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
        } catch {
          // Called from a Server Component, which can't set cookies —
          // proxy.ts refreshes the session on the next request instead.
        }
      },
    },
  });
}
