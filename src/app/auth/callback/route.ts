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
 *
 * DIAGNOSTIC LOGGING (temporary — see PROJECT_STATUS.md "Auth diagnostics"):
 * logs which stage ran and whether it succeeded, using only booleans/enums/
 * the request host — never the code, token_hash, or any cookie value. If
 * this route is reached on the wrong origin (e.g. Supabase's Site URL
 * fallback substituting production for a Preview redirectTo), `[auth-cb]
 * host=` makes that immediately visible in server logs.
 */
export async function GET(request: Request) {
  const { searchParams, origin, host } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const errorDescription =
    searchParams.get("error_description") ?? searchParams.get("error");

  console.log("[auth-cb] host=%s hasCode=%s hasTokenHash=%s hasError=%s", host, Boolean(code), Boolean(tokenHash), Boolean(errorDescription));

  const fail = (raw: string) => {
    console.error("[auth-cb] failed:", raw);
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
    console.log("[auth-cb] verifyOtp(token_hash) ok=%s", !error);
    return error ? fail(error.message) : NextResponse.redirect(`${origin}${next}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[auth-cb] exchangeCodeForSession ok=%s", !error);
    if (!error) {
      // Confirm the session is actually retrievable within this same
      // request before redirecting — if this is false while ok=true above,
      // the exchange "succeeded" but cookies weren't written correctly.
      const { data } = await supabase.auth.getUser();
      console.log("[auth-cb] post-exchange getUser present=%s", Boolean(data.user));
    }
    return error ? fail(error.message) : NextResponse.redirect(`${origin}${next}`);
  }

  return fail(errorDescription ?? "callback reached with no credentials");
}
