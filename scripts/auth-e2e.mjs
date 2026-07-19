/**
 * Live verification of the email auth paths against the real Supabase
 * project, without sending any email: admin.generateLink() returns both the
 * numeric OTP and the token hash that the emailed message would carry.
 *
 *   node --env-file=.env.local scripts/auth-e2e.mjs
 *
 * Uses a disposable test user, removed afterwards. Never touches real data.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !pub || !secret || secret.startsWith("<PASTE_")) {
  console.error("Missing Supabase env vars (run with --env-file=.env.local).");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });

const results = [];
const ok = (name, pass, note = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

let userId;
const EMAIL = `splitzy-auth-e2e-${Date.now()}@example.com`;
try {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
  });
  if (cErr) throw cErr;
  userId = created.user.id;

  // profiles trigger fired exactly once (duplicate-profile guard)
  const { data: profs } = await admin.from("profiles").select("id").eq("id", userId);
  ok("new user gets exactly one profile", profs?.length === 1);

  // ── 1. Numeric OTP path (what the PWA flow uses) ─────────────────────────
  const { data: link1, error: l1 } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (l1) throw l1;
  // This project is configured for 8-digit codes; accept 6-8.
  const otpCode = link1.properties.email_otp;
  ok("generateLink exposes a numeric OTP", /^\d{6,8}$/.test(otpCode ?? ""), `len=${otpCode?.length}`);

  const client1 = createClient(url, pub, { auth: { persistSession: false } });
  const { data: v1, error: e1 } = await client1.auth.verifyOtp({
    email: EMAIL,
    token: otpCode,
    type: "email",
  });
  ok("verifyOtp(email + 6-digit code) creates a session", !e1 && Boolean(v1?.session), e1?.message ?? "");

  // Reusing the same code must fail
  const client1b = createClient(url, pub, { auth: { persistSession: false } });
  const { error: reuseErr } = await client1b.auth.verifyOtp({
    email: EMAIL,
    token: otpCode,
    type: "email",
  });
  ok("reused code is rejected", Boolean(reuseErr), reuseErr?.message ?? "");

  // Wrong code must fail
  const { error: wrongErr } = await client1b.auth.verifyOtp({
    email: EMAIL,
    token: "000000",
    type: "email",
  });
  ok("wrong code is rejected", Boolean(wrongErr));

  await client1.auth.signOut();

  // ── 2. token_hash path (the cross-context-safe emailed link) ─────────────
  const { data: link2, error: l2 } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (l2) throw l2;
  const client2 = createClient(url, pub, { auth: { persistSession: false } });
  const { data: v2, error: e2 } = await client2.auth.verifyOtp({
    type: "email",
    token_hash: link2.properties.hashed_token,
  });
  ok(
    "verifyOtp(token_hash) creates a session with NO PKCE verifier (cross-context safe)",
    !e2 && Boolean(v2?.session),
    e2?.message ?? "",
  );
  await client2.auth.signOut();
} catch (err) {
  ok("UNEXPECTED ERROR", false, err.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log("cleanup: test user removed");
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
