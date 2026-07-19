import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-safe client. Uses the publishable key only — it has no write
 * access to `expenses`/`expense_participants` beyond what RLS grants (reads,
 * plus the `expenses` soft-delete update). It can never call
 * `add_equal_expense()` (service_role-only) — that goes through
 * `/api/expenses` instead. See `supabase-server.ts` for the privileged client.
 *
 * `createBrowserClient` (from `@supabase/ssr`) stores the auth session in
 * cookies instead of localStorage, so the session is visible to `proxy.ts`
 * and Server Components too — that's what makes route protection possible.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Treats the checked-in `<PASTE_..._HERE>` placeholders as "not set" too. */
function isFilledIn(value: string | undefined): value is string {
  return Boolean(value) && !value!.startsWith("<PASTE_");
}

/** False until `.env.local` has real Supabase credentials (not placeholders). */
export const isSupabaseConfigured = isFilledIn(url) && isFilledIn(publishableKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }
  client ??= createBrowserClient(url!, publishableKey!);
  return client;
}
