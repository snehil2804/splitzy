/**
 * Live verification of the offline-sync idempotency guarantee added in
 * `20260721130000_offline_expense_idempotency.sql`: a retried
 * `add_expense()` call carrying the same `p_offline_idempotency_key`
 * returns the already-created row instead of inserting a duplicate, scoped
 * per-caller, with `created_by` always structurally derived from the
 * caller's own session (never a client-supplied value). Runs inside a
 * disposable test trip + user, fully removed afterwards.
 *
 *   node --env-file=.env.local scripts/offline-idempotency-e2e.mjs
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

let ownerUserId, strangerUserId, tripId, strangerTripId;
let ownerClient, strangerClient;

/**
 * Trips have FK-referencing children (expenses, trip_members, ...) with no
 * cascade — a plain `trips.delete()` silently no-ops against the FK
 * constraint instead of erroring. `delete_trip()` is the real, FK-safe,
 * atomic removal path (owner-only) and is what must be used here too.
 */
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
  if (strangerTripId && strangerClient) {
    const { error } = await strangerClient.rpc("delete_trip", { p_trip_id: strangerTripId });
    if (error) console.error("cleanup: failed to delete stranger test trip:", error.message);
  }
  await deleteTestUser(ownerUserId);
  await deleteTestUser(strangerUserId);
  console.log("cleanup: all test artifacts removed");
}

async function main() {
  const stamp = Date.now();
  const ownerEmail = `offline-idem-owner-${stamp}@example.test`;
  const strangerEmail = `offline-idem-stranger-${stamp}@example.test`;

  const owner = await sessionFor(ownerEmail);
  ownerClient = owner;
  const { data: ownerUser } = await owner.auth.getUser();
  ownerUserId = ownerUser.user.id;

  const stranger = await sessionFor(strangerEmail);
  strangerClient = stranger;
  const { data: strangerUser } = await stranger.auth.getUser();
  strangerUserId = strangerUser.user.id;

  const { data: tid, error: tripErr } = await owner.rpc("create_trip", {
    p_name: `Offline idempotency test ${stamp}`,
    p_member_name: "Owner",
  });
  if (tripErr) throw tripErr;
  tripId = tid;

  const { data: members } = await owner
    .from("trip_members")
    .select("member_id, members(user_id)")
    .eq("trip_id", tripId);
  const ownerMemberId = members.find((m) => m.members.user_id === ownerUserId).member_id;

  // ── Same key, called twice: must return the same expense id, one row ──
  const key = randomUUID();
  const { data: firstId, error: firstErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 250,
    p_description: "Idempotency test expense",
    p_participant_ids: [ownerMemberId],
    p_offline_idempotency_key: key,
  });
  ok("first sync attempt succeeds", !firstErr, firstErr?.message);

  const { data: secondId, error: secondErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 250,
    p_description: "Idempotency test expense",
    p_participant_ids: [ownerMemberId],
    p_offline_idempotency_key: key,
  });
  ok("retried sync with the same key returns the same expense id", secondId === firstId, secondErr?.message);

  const { data: rowsWithKey } = await admin
    .from("expenses")
    .select("id")
    .eq("offline_idempotency_key", key);
  ok("only one row exists for that key, not two", rowsWithKey.length === 1, `found ${rowsWithKey.length}`);

  const { data: createdRow } = await admin
    .from("expenses")
    .select("created_by")
    .eq("id", firstId)
    .single();
  ok(
    "created_by is the caller's own auth id, never client-influenced",
    createdRow.created_by === ownerUserId,
  );

  // ── A different key creates a genuinely new row ──
  const { data: thirdId, error: thirdErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 100,
    p_description: "A second, distinct offline expense",
    p_participant_ids: [ownerMemberId],
    p_offline_idempotency_key: randomUUID(),
  });
  ok("a different idempotency key creates a new, distinct expense", !thirdErr && thirdId !== firstId, thirdErr?.message);

  // ── The unique index is scoped per-creator, not global: a different
  //    user reusing the exact same key value (on their own trip, so this
  //    isn't conflated with the separate "not a member" rejection) must
  //    succeed on its own merits rather than colliding with the owner's row. ──
  const { data: strangerTid, error: strangerTripErr } = await stranger.rpc("create_trip", {
    p_name: `Offline idempotency stranger trip ${stamp}`,
    p_member_name: "Stranger",
  });
  if (strangerTripErr) throw strangerTripErr;
  strangerTripId = strangerTid;
  const { data: strangerMembers } = await stranger
    .from("trip_members")
    .select("member_id, members(user_id)")
    .eq("trip_id", strangerTripId);
  const strangerMemberId = strangerMembers.find((m) => m.members.user_id === strangerUserId).member_id;

  const { data: strangerExpenseId, error: strangerExpenseErr } = await stranger.rpc("add_expense", {
    p_trip_id: strangerTripId,
    p_paid_by: strangerMemberId,
    p_amount: 50,
    p_description: "Stranger reusing the owner's exact key value",
    p_participant_ids: [strangerMemberId],
    p_offline_idempotency_key: key,
  });
  ok(
    "a different user reusing the same literal key value succeeds (per-creator scoping)",
    !strangerExpenseErr && strangerExpenseId !== firstId,
    strangerExpenseErr?.message,
  );

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exitCode = 1;
  })
  .finally(cleanup);
