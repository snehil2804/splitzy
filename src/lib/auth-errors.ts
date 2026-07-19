/**
 * Auth failures are shown to users as stable, friendly codes — never raw
 * GoTrue/Supabase messages (those leak internals like "PKCE code verifier
 * not found in storage" and change between SDK versions). The callback
 * route classifies raw errors into an `AuthErrorCode`, puts only the code
 * in the redirect URL, and the login page maps codes to copy.
 */

export type AuthErrorCode =
  | "link_other_context" // magic link opened in a different browser/device
  | "link_expired" // expired or already-used link / code
  | "otp_invalid" // wrong or mistyped verification code
  | "rate_limited" // too many email requests
  | "oauth_failed" // provider (Google) flow did not complete
  | "auth_failed"; // anything else

/** Classify a raw Supabase/GoTrue error message. Never shown to users. */
export function classifyAuthError(rawMessage: string): AuthErrorCode {
  const m = rawMessage.toLowerCase();
  if (m.includes("code verifier") || m.includes("verifier")) {
    return "link_other_context";
  }
  if (
    m.includes("expired") ||
    m.includes("invalid or has expired") ||
    m.includes("otp_expired") ||
    m.includes("already been used")
  ) {
    return "link_expired";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "rate_limited";
  }
  if (m.includes("token") && m.includes("invalid")) {
    return "otp_invalid";
  }
  if (m.includes("oauth") || m.includes("provider") || m.includes("bad_oauth")) {
    return "oauth_failed";
  }
  return "auth_failed";
}

export const AUTH_ERROR_COPY: Record<AuthErrorCode, string> = {
  link_other_context:
    "That sign-in link was opened in a different browser or device than the one that requested it. Use Google Sign-In, or request a verification code below and type it in here.",
  link_expired:
    "That sign-in link or code has expired or was already used. Request a fresh one below.",
  otp_invalid: "That code doesn't match. Double-check the digits and try again.",
  rate_limited:
    "Too many sign-in emails in a short time. Wait a few minutes, or use Google Sign-In.",
  oauth_failed:
    "Google sign-in didn't complete. Try again, or use a verification code instead.",
  auth_failed: "Sign-in didn't work this time. Try again, or use Google Sign-In.",
};

export function authErrorCopy(code: string | null): string | null {
  if (!code) return null;
  return AUTH_ERROR_COPY[code as AuthErrorCode] ?? AUTH_ERROR_COPY.auth_failed;
}

/**
 * Post-login destinations must stay on our own origin. Accept only
 * absolute-path URLs ("/expenses"), rejecting anything protocol-relative
 * ("//evil.com"), absolute ("https://…"), or otherwise malformed.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }
  return next;
}
