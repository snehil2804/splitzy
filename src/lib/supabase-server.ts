import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client, authenticated with the secret key. This has
 * full database privileges, including `add_equal_expense()` (service_role
 * only) — import it ONLY from Route Handlers or other server-only code,
 * never from a "use client" file. `SUPABASE_SECRET_KEY` has no
 * `NEXT_PUBLIC_` prefix, so Next.js never inlines it into a browser bundle
 * regardless; this file just keeps that boundary explicit.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

/** Treats the checked-in `<PASTE_..._HERE>` placeholders as "not set" too. */
function isFilledIn(value: string | undefined): value is string {
  return Boolean(value) && !value!.startsWith("<PASTE_");
}

/** False until `.env.local` has the server-side Supabase credential (not a placeholder). */
export const isSupabaseServerConfigured = isFilledIn(url) && isFilledIn(secretKey);

let client: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (!isSupabaseServerConfigured) {
    throw new Error(
      "Supabase server credentials are not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env.local.",
    );
  }
  client ??= createClient(url!, secretKey!, {
    auth: { persistSession: false },
  });
  return client;
}
