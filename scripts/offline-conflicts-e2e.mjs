/**
 * Live verification that the conditions the offline sync endpoint maps to
 * its specific conflict copy ("This trip is no longer available.", "One or
 * more members are no longer part of this trip.") are exactly what
 * `add_expense()` itself raises — i.e. that `friendlyConflictMessage()` in
 * `src/app/api/expenses/sync/route.ts` is matching real RPC output, not
 * text that's since drifted. Runs inside a disposable test trip + users,
 * fully removed afterwards.
 *
 *   node --env-file=.env.local scripts/offline-conflicts-e2e.mjs
 */
import { randomUUID } from "node:crypto";
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

let ownerUserId, memberUserId, tripId;
let ownerClient;

/**
 * `delete_trip()` removes `trip_members` but deliberately never touches the
 * standalone `members` row itself (identity persists across trips) — that
 * row's `user_id` FK has no cascade, so deleting the auth user while it
 * still exists fails. Must be removed first, and the deleteUser result
 * must actually be checked — the Admin API does not throw on failure.
 */
async function deleteTestUser(userId) {
  if (!userId) return;
  const { error: memberErr } = await admin.from("members").delete().eq("user_id", userId);
  if (memberErr) console.error(`cleanup: failed to delete member row for ${userId}:`, memberErr.message);
  const { error: userErr } = await admin.auth.admin.deleteUser(userId);
  if (userErr) console.error(`cleanup: failed to delete auth user ${userId}:`, userErr.message);
}

async function cleanup() {
  if (tripId && ownerClient) {
    const { error } = await ownerClient.rpc("delete_trip", { p_trip_id: tripId });
    if (error) console.error("cleanup: failed to delete test trip:", error.message);
  }
  await deleteTestUser(ownerUserId);
  await deleteTestUser(memberUserId);
  console.log("cleanup: all test artifacts removed");
}

/** Mirrors friendlyConflictMessage() in src/app/api/expenses/sync/route.ts exactly. */
function friendlyConflictMessage(raw) {
  if (/does not exist or is not active/i.test(raw)) return "This trip is no longer available.";
  if (/payer is not an active member|participant must be an active member/i.test(raw)) {
    return "One or more members are no longer part of this trip.";
  }
  if (/not a member of this trip/i.test(raw)) return "This trip is no longer available.";
  if (/must be signed in/i.test(raw)) return "Please reconnect and sign in before syncing.";
  return raw;
}

async function main() {
  const stamp = Date.now();
  const ownerEmail = `offline-conflict-owner-${stamp}@example.test`;
  const memberEmail = `offline-conflict-member-${stamp}@example.test`;

  const owner = await sessionFor(ownerEmail);
  ownerClient = owner;
  const { data: ownerUser } = await owner.auth.getUser();
  ownerUserId = ownerUser.user.id;

  const member = await sessionFor(memberEmail);
  const { data: memberUser } = await member.auth.getUser();
  memberUserId = memberUser.user.id;

  const { data: tid, error: tripErr } = await owner.rpc("create_trip", {
    p_name: `Offline conflict test ${stamp}`,
    p_member_name: `Owner ${stamp}`,
  });
  if (tripErr) throw tripErr;
  tripId = tid;

  const { data: guestMemberId, error: guestErr } = await owner.rpc("add_guest_member", {
    p_trip_id: tripId,
    p_name: `Guest ${stamp}`,
  });
  if (guestErr) throw guestErr;
  const { data: inviteToken, error: inviteErr } = await owner.rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: guestMemberId,
  });
  if (inviteErr) throw inviteErr;
  const { error: claimErr } = await member.rpc("claim_invitation", { p_token: inviteToken });
  if (claimErr) throw claimErr;

  const { data: members } = await owner
    .from("trip_members")
    .select("member_id, members(user_id)")
    .eq("trip_id", tripId);
  const ownerMemberId = members.find((m) => m.members.user_id === ownerUserId).member_id;

  // ── Removed participant: the guest is deactivated, then an offline
  //    expense that still lists them as a participant is "synced" ──
  await owner.rpc("set_trip_member_active", {
    p_trip_id: tripId,
    p_member_id: guestMemberId,
    p_active: false,
  });

  const { error: removedParticipantErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 100,
    p_description: "Offline expense with a since-removed participant",
    p_participant_ids: [ownerMemberId, guestMemberId],
    p_offline_idempotency_key: randomUUID(),
  });
  ok(
    "add_expense rejects a since-removed participant",
    !!removedParticipantErr && /participant must be an active member/i.test(removedParticipantErr.message),
    removedParticipantErr?.message,
  );
  ok(
    "...and the sync endpoint's mapping produces the exact expected offline-UI copy",
    removedParticipantErr &&
      friendlyConflictMessage(removedParticipantErr.message) ===
        "One or more members are no longer part of this trip.",
  );

  // ── Removed payer: same rejection path, different field ──
  const { error: removedPayerErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: guestMemberId,
    p_amount: 50,
    p_description: "Offline expense paid by a since-removed member",
    p_participant_ids: [ownerMemberId],
    p_offline_idempotency_key: randomUUID(),
  });
  ok(
    "add_expense rejects a since-removed payer",
    !!removedPayerErr && /payer is not an active member/i.test(removedPayerErr.message),
    removedPayerErr?.message,
  );
  ok(
    "...and maps to the same expected offline-UI copy",
    removedPayerErr &&
      friendlyConflictMessage(removedPayerErr.message) ===
        "One or more members are no longer part of this trip.",
  );

  // ── Deleted / archived trip ──
  await owner.from("trips").update({ status: "archived" }).eq("id", tripId);

  const { error: archivedTripErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 75,
    p_description: "Offline expense against an archived trip",
    p_participant_ids: [ownerMemberId],
    p_offline_idempotency_key: randomUUID(),
  });
  ok(
    "add_expense rejects an archived trip",
    !!archivedTripErr && /does not exist or is not active/i.test(archivedTripErr.message),
    archivedTripErr?.message,
  );
  ok(
    "...and maps to the expected 'no longer available' copy",
    archivedTripErr &&
      friendlyConflictMessage(archivedTripErr.message) === "This trip is no longer available.",
  );

  // Reactivate so delete_trip() can run cleanly during cleanup.
  await owner.from("trips").update({ status: "active" }).eq("id", tripId);

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exitCode = 1;
  })
  .finally(cleanup);
