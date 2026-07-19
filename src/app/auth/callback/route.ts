import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { classifyAuthError, safeNextPath } from "@/lib/auth-errors";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * Single landing point for every auth handoff:
 *
 * - `?code=`               OAuth (Google) and PKCE magic links. Requires the
 *                          code-verifier cookie, so it only succeeds in the
 *                          browser that started the flow.
 * - `?token_hash=&type=`   Email links using the {{ .TokenHash }} template.
 *                          Verified server-side with no verifier, so these
 *                          work even when the link opens in a different
 *                          browser or device than the one that requested it.
 * - `?error_description=`  GoTrue rejected the attempt before reaching us.
 *
 * Failures redirect to /login with a stable error *code* — raw provider
 * messages are logged server-side, never shown to users. The `next` path is
 * validated to same-origin to prevent open redirects.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const errorDescription =
    searchParams.get("error_description") ?? searchParams.get("error");

  const fail = (raw: string) => {
    console.error("Auth callback failed:", raw);
    return NextResponse.redirect(
      `${origin}/login?auth_error=${classifyAuthError(raw)}`,
    );
  };

  const supabase = await getSupabaseAuthServer();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    return error ? fail(error.message) : NextResponse.redirect(`${origin}${next}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? fail(error.message) : NextResponse.redirect(`${origin}${next}`);
  }

  return fail(errorDescription ?? "callback reached with no credentials");
}
