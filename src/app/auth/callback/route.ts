import { NextResponse } from "next/server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * PKCE magic-link landing point: `signInWithOtp()`'s `emailRedirectTo` points
 * here. Supabase's own `/auth/v1/verify` redirect either forwards `?code=`
 * (success — exchange it for a session) or `?error_description=` (link
 * already used, expired, or otherwise rejected before we ever see a code).
 * Origin is taken from the incoming request, not a configured constant, so
 * this works unchanged on localhost, previews, and production.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const errorDescription = searchParams.get("error_description");

  if (code) {
    const supabase = await getSupabaseAuthServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const message = errorDescription
    ? errorDescription.replace(/\+/g, " ")
    : "That link is invalid or has expired. Request a new one below.";
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
}
