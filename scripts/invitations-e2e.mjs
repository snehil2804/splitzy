/**
 * Live verification of the invitation/claim architecture against the real
 * Supabase project — token generation, anon-safe preview, claim security
 * (single-use, expiry, cross-member-lock, no email gate on the token
 * itself), and RLS isolation. Everything runs inside a disposable test
 * trip + disposable test users, fully removed afterwards.
 *
 *   node --env-file=.env.local scripts/invitations-e2e.mjs
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
const anon = createClient(url, pub, { auth: { persistSession: false } });

const results = [];
const ok = (name, pass, note = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

async function sessionFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(url, pub, { auth: { persistSession: false } });
  const { error: vErr } = await client.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (vErr) throw vErr;
  return client;
}

let ownerUserId, claimantUserId, secondUserId;
let tripId, ownerMemberId, guestId, guestId2;
let invitationIds = [];
try {
  // ── setup: owner + trip + guest to invite ────────────────────────────────
  const ownerEmail = `splitzy-inv-owner-${Date.now()}@example.com`;
  const { data: ownerCreated, error: oErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });
  if (oErr) throw oErr;
  ownerUserId = ownerCreated.user.id;
  const owner = await sessionFor(ownerEmail);

  const { data: newTripId, error: ctErr } = await owner.rpc("create_trip", {
    p_name: "E2E Invite Trip",
    p_member_name: "E2E Owner",
  });
  if (ctErr) throw ctErr;
  tripId = newTripId;
  const { data: ownerTm } = await admin
    .from("trip_members")
    .select("member_id")
    .eq("trip_id", tripId)
    .eq("role", "owner")
    .single();
  ownerMemberId = ownerTm?.member_id;

  // ── 1. invite_member requires a member target (UUID-based, not email) ───
  const { error: noMemberErr } = await owner.rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: null,
  });
  ok("invite_member rejects a missing member target", Boolean(noMemberErr));

  const { data: gid, error: gErr } = await owner.rpc("add_guest_member", {
    p_trip_id: tripId,
    p_name: `E2E Guest ${Date.now()}`,
  });
  if (gErr) throw gErr;
  guestId = gid;

  const { data: token, error: invErr } = await owner.rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: guestId,
  });
  if (invErr) throw invErr;
  ok("invite_member returns a token", typeof token === "string" && token.length >= 32, `len=${token?.length}`);

  const { data: invRow } = await admin
    .from("invitations")
    .select("id")
    .eq("token", token)
    .single();
  invitationIds.push(invRow.id);

  // ── 2. preview_invitation works anonymously (no session) ────────────────
  const { data: preview, error: pErr } = await anon.rpc("preview_invitation", {
    p_token: token,
  });
  const previewRow = preview?.[0];
  ok(
    "anon can preview a valid invitation (trip + member name, no other data)",
    !pErr && previewRow?.trip_name === "E2E Invite Trip" && previewRow?.is_valid === true,
    pErr?.message ?? "",
  );

  const { data: badPreview } = await anon.rpc("preview_invitation", {
    p_token: "not-a-real-token",
  });
  ok("preview_invitation returns nothing for an unknown token", (badPreview ?? []).length === 0);

  // ── 3. claim_invitation requires auth ────────────────────────────────────
  const { error: anonClaimErr } = await anon.rpc("claim_invitation", { p_token: token });
  ok("anonymous claim is rejected", Boolean(anonClaimErr));

  // ── 4. real claim: recipient signs in with a DIFFERENT email than any
  //    invite email (none was set) — token alone is the credential ────────
  const claimantEmail = `splitzy-inv-claimant-${Date.now()}@example.com`;
  const { data: claimantCreated, error: cErr } = await admin.auth.admin.createUser({
    email: claimantEmail,
    email_confirm: true,
  });
  if (cErr) throw cErr;
  claimantUserId = claimantCreated.user.id;
  const claimant = await sessionFor(claimantEmail);

  const { data: claimedTripId, error: claimErr } = await claimant.rpc("claim_invitation", {
    p_token: token,
  });
  ok("claim succeeds with no email match required", !claimErr && claimedTripId === tripId, claimErr?.message ?? "");

  const { data: linkedMember } = await admin
    .from("members")
    .select("user_id")
    .eq("id", guestId)
    .single();
  ok("member.user_id now linked to the claimant", linkedMember?.user_id === claimantUserId);

  const { data: tm } = await admin
    .from("trip_members")
    .select("is_active, role")
    .eq("trip_id", tripId)
    .eq("member_id", guestId)
    .single();
  ok("trip membership activated for the claimed member", tm?.is_active === true);

  // ── 5. single-use: the same token cannot be claimed again ───────────────
  const { error: replayErr } = await claimant.rpc("claim_invitation", { p_token: token });
  ok("replaying the same token is rejected", Boolean(replayErr), replayErr?.message ?? "");

  // ── 6. one auth account can never be linked to two different members ────
  const { data: gid2, error: g2Err } = await owner.rpc("add_guest_member", {
    p_trip_id: tripId,
    p_name: `E2E Guest 2 ${Date.now()}`,
  });
  if (g2Err) throw g2Err;
  guestId2 = gid2;
  const { data: token2, error: inv2Err } = await owner.rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: guestId2,
  });
  if (inv2Err) throw inv2Err;
  const { data: invRow2 } = await admin.from("invitations").select("id").eq("token", token2).single();
  invitationIds.push(invRow2.id);

  const { error: crossClaimErr } = await claimant.rpc("claim_invitation", { p_token: token2 });
  ok(
    "an already-linked account cannot claim a second member",
    Boolean(crossClaimErr) && /already linked/i.test(crossClaimErr?.message ?? ""),
    crossClaimErr?.message ?? "",
  );

  // ── 7. expiry ─────────────────────────────────────────────────────────
  const { error: expireSetErr } = await admin
    .from("invitations")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", invRow2.id);
  if (expireSetErr) throw expireSetErr;

  const secondEmail = `splitzy-inv-second-${Date.now()}@example.com`;
  const { data: secondCreated, error: sErr } = await admin.auth.admin.createUser({
    email: secondEmail,
    email_confirm: true,
  });
  if (sErr) throw sErr;
  secondUserId = secondCreated.user.id;
  const second = await sessionFor(secondEmail);

  const { error: expiredClaimErr } = await second.rpc("claim_invitation", { p_token: token2 });
  ok(
    "expired invitation cannot be claimed",
    Boolean(expiredClaimErr) && /expired/i.test(expiredClaimErr?.message ?? ""),
    expiredClaimErr?.message ?? "",
  );

  const { data: expiredPreview } = await anon.rpc("preview_invitation", { p_token: token2 });
  ok("preview also reports the expired invite as invalid", expiredPreview?.[0]?.is_valid === false);

  // ── RLS sanity: a non-member cannot read the trip's data ────────────────
  const { data: leak } = await second.from("expenses").select("id").eq("trip_id", tripId);
  ok("a non-member cannot read the trip's expenses", (leak ?? []).length === 0);

  // ── regression: the frontend used to fire accept_my_invitations() (the
  //    email-matched auto-claim) on every login, racing /join's explicit
  //    claim_invitation() whenever an invite carried a matching email —
  //    reported as "invite link expired/revoked" despite a real, correct
  //    claim having already happened. That auto-call is now removed from
  //    useSession.ts; this proves the DB-level contract stays safe even if
  //    something *does* call accept_my_invitations() first: the member
  //    still gets linked correctly, and claim_invitation() on the same
  //    token afterward fails cleanly (no corruption, no crash) rather than
  //    double-claiming or leaving inconsistent state. ─────────────────────
  const { data: gid3, error: g3Err } = await owner.rpc("add_guest_member", {
    p_trip_id: tripId,
    p_name: `E2E Guest 3 ${Date.now()}`,
  });
  if (g3Err) throw g3Err;
  const guestId3 = gid3;
  const thirdEmail = `splitzy-inv-third-${Date.now()}@example.com`;
  const { data: token3, error: inv3Err } = await owner.rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: guestId3,
    p_email: thirdEmail,
  });
  if (inv3Err) throw inv3Err;
  const { data: invRow3 } = await admin.from("invitations").select("id").eq("token", token3).single();
  invitationIds.push(invRow3.id);

  const { data: thirdCreated, error: tErr } = await admin.auth.admin.createUser({
    email: thirdEmail,
    email_confirm: true,
  });
  if (tErr) throw tErr;
  const thirdUserId = thirdCreated.user.id;
  const third = await sessionFor(thirdEmail);

  // Simulate the old background path racing ahead of /join's own claim.
  const { error: autoAcceptErr } = await third.rpc("accept_my_invitations");
  ok("accept_my_invitations still claims by matching email (legacy path intact)", !autoAcceptErr, autoAcceptErr?.message ?? "");

  const { data: autoLinked } = await admin.from("members").select("user_id").eq("id", guestId3).single();
  ok("...and correctly links the member", autoLinked?.user_id === thirdUserId);

  const { error: raceClaimErr } = await third.rpc("claim_invitation", { p_token: token3 });
  ok(
    "claim_invitation() on the now-already-accepted token fails cleanly, no corruption",
    Boolean(raceClaimErr) && /invalid or has already been used/i.test(raceClaimErr?.message ?? ""),
    raceClaimErr?.message ?? "",
  );

  await admin.from("trip_members").delete().eq("trip_id", tripId).eq("member_id", guestId3);
  await admin.from("members").delete().eq("id", guestId3);
  await admin.auth.admin.deleteUser(thirdUserId);
  await third.auth.signOut();

  await owner.auth.signOut();
  await claimant.auth.signOut();
  await second.auth.signOut();
} catch (err) {
  ok("UNEXPECTED ERROR", false, err.message);
} finally {
  try {
    if (invitationIds.length) {
      await admin.from("invitations").delete().in("id", invitationIds);
    }
    if (tripId) {
      await admin.from("expenses").delete().eq("trip_id", tripId);
      await admin.from("trip_members").delete().eq("trip_id", tripId);
      await admin.from("trips").delete().eq("id", tripId);
    }
    if (guestId) await admin.from("members").delete().eq("id", guestId);
    if (guestId2) await admin.from("members").delete().eq("id", guestId2);
    if (ownerMemberId) await admin.from("members").delete().eq("id", ownerMemberId);
    for (const uid of [ownerUserId, claimantUserId, secondUserId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
    console.log("cleanup: all test artifacts removed");
  } catch (e) {
    console.log("cleanup error:", e.message);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
