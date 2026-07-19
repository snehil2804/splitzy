import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_ERROR_COPY,
  authErrorCopy,
  classifyAuthError,
  safeNextPath,
} from "../src/lib/auth-errors";

test("PKCE verifier failure becomes the other-context recovery state", () => {
  assert.equal(
    classifyAuthError("PKCE code verifier not found in storage"),
    "link_other_context",
  );
});

test("expired and reused links classify as link_expired", () => {
  assert.equal(classifyAuthError("Email link is invalid or has expired"), "link_expired");
  assert.equal(classifyAuthError("otp_expired"), "link_expired");
  assert.equal(classifyAuthError("Token has already been used"), "link_expired");
});

test("rate limits classify as rate_limited", () => {
  assert.equal(classifyAuthError("email rate limit exceeded"), "rate_limited");
  assert.equal(classifyAuthError("429: Too many requests"), "rate_limited");
});

test("unknown errors fall back to auth_failed", () => {
  assert.equal(classifyAuthError("something unexpected"), "auth_failed");
});

test("no friendly copy ever contains internal jargon", () => {
  for (const copy of Object.values(AUTH_ERROR_COPY)) {
    for (const banned of ["PKCE", "verifier", "supabase", "token_hash", "exchange"]) {
      assert.ok(
        !copy.toLowerCase().includes(banned.toLowerCase()),
        `"${copy}" contains "${banned}"`,
      );
    }
  }
});

test("authErrorCopy maps unknown codes to the generic message", () => {
  assert.equal(authErrorCopy(null), null);
  assert.equal(authErrorCopy("link_other_context"), AUTH_ERROR_COPY.link_other_context);
  assert.equal(authErrorCopy("made_up_code"), AUTH_ERROR_COPY.auth_failed);
});

test("safeNextPath blocks open redirects", () => {
  assert.equal(safeNextPath("/expenses"), "/expenses");
  assert.equal(safeNextPath("/trips?tab=members"), "/trips?tab=members");
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath(""), "/");
  assert.equal(safeNextPath("//evil.com"), "/");
  assert.equal(safeNextPath("https://evil.com"), "/");
  assert.equal(safeNextPath("javascript:alert(1)"), "/");
  assert.equal(safeNextPath("/\\evil.com"), "/");
  assert.equal(safeNextPath("expenses"), "/");
});
