/**
 * Live verification of the Stage 3 trip/expense/balance/settlement engine
 * against the real Supabase project: expense CRUD, all 4 split methods
 * (with the same validation the DB enforces), creator-or-owner edit/delete
 * permissions, settlement recording, trip lifecycle (transfer ownership,
 * leave, delete), the activity-log triggers, and RLS isolation. Everything
 * runs inside disposable test trips + disposable test users, fully removed
 * afterwards.
 *
 *   node --env-file=.env.local scripts/trip-expense-engine-e2e.mjs
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

async function claimGuest(ownerClient, tripId, name, email) {
  const { data: memberId, error: gErr } = await ownerClient.rpc("add_guest_member", {
    p_trip_id: tripId,
    p_name: name,
  });
  if (gErr) throw gErr;
  const { data: token, error: invErr } = await ownerClient.rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: memberId,
  });
  if (invErr) throw invErr;
  const client = await sessionFor(email);
  const { error: claimErr } = await client.rpc("claim_invitation", { p_token: token });
  if (claimErr) throw claimErr;
  return { client, memberId };
}

let ownerUserId, memberUserId, strangerUserId;
let tripId;
let ownerMemberId, memberMemberId;
let owner, member, stranger;

try {
  // ── setup: owner + trip + a claimed second member ──────────────────────
  const ownerEmail = `splitzy-tee-owner-${Date.now()}@example.com`;
  const { data: ownerCreated, error: oErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });
  if (oErr) throw oErr;
  ownerUserId = ownerCreated.user.id;
  owner = await sessionFor(ownerEmail);

  const { data: newTripId, error: ctErr } = await owner.rpc("create_trip", {
    p_name: "E2E Expense Engine Trip",
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

  const memberEmail = `splitzy-tee-member-${Date.now()}@example.com`;
  const claimed = await claimGuest(owner, tripId, "E2E Member", memberEmail);
  member = claimed.client;
  memberMemberId = claimed.memberId;
  const { data: memberRow } = await admin.from("members").select("user_id").eq("id", memberMemberId).single();
  memberUserId = memberRow.user_id;

  const strangerEmail = `splitzy-tee-stranger-${Date.now()}@example.com`;
  const { data: strangerCreated, error: sErr } = await admin.auth.admin.createUser({
    email: strangerEmail,
    email_confirm: true,
  });
  if (sErr) throw sErr;
  strangerUserId = strangerCreated.user.id;
  stranger = await sessionFor(strangerEmail);

  // ── 1. equal split ────────────────────────────────────────────────────
  const { data: equalExpenseId, error: equalErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 900,
    p_description: "Equal dinner",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "equal",
  });
  ok("equal split: add_expense succeeds", !equalErr && typeof equalExpenseId === "string", equalErr?.message ?? "");

  const { data: equalParts } = await admin
    .from("expense_participants")
    .select("member_id, share_amount")
    .eq("expense_id", equalExpenseId);
  const equalSum = (equalParts ?? []).reduce((s, p) => s + Number(p.share_amount), 0);
  ok(
    "equal split: shares are equal and sum to the total",
    equalParts?.length === 2 &&
      equalParts.every((p) => Number(p.share_amount) === 450) &&
      equalSum === 900,
  );

  // ── 2. exact split ────────────────────────────────────────────────────
  const { error: exactBadErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 500,
    p_description: "Exact — bad sum",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "exact",
    p_splits: [
      { member_id: ownerMemberId, value: 200 },
      { member_id: memberMemberId, value: 200 },
    ],
  });
  ok(
    "exact split: amounts not summing to the total are rejected",
    Boolean(exactBadErr) && /add up to/i.test(exactBadErr?.message ?? ""),
    exactBadErr?.message ?? "",
  );

  const { error: exactNegErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 500,
    p_description: "Exact — negative",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "exact",
    p_splits: [
      { member_id: ownerMemberId, value: 600 },
      { member_id: memberMemberId, value: -100 },
    ],
  });
  ok(
    "exact split: a non-positive amount is rejected",
    Boolean(exactNegErr) && /greater than zero/i.test(exactNegErr?.message ?? ""),
    exactNegErr?.message ?? "",
  );

  const { data: exactExpenseId, error: exactOkErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 500,
    p_description: "Exact — good",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "exact",
    p_splits: [
      { member_id: ownerMemberId, value: 350 },
      { member_id: memberMemberId, value: 150 },
    ],
  });
  ok("exact split: a correctly-summed split is accepted", !exactOkErr, exactOkErr?.message ?? "");
  const { data: exactParts } = await admin
    .from("expense_participants")
    .select("member_id, share_amount")
    .eq("expense_id", exactExpenseId);
  ok(
    "exact split: stored shares match the requested amounts exactly",
    exactParts?.find((p) => p.member_id === ownerMemberId)?.share_amount == 350 &&
      exactParts?.find((p) => p.member_id === memberMemberId)?.share_amount == 150,
  );

  // ── 3. percentage split ───────────────────────────────────────────────
  const { error: pctBadErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 1000,
    p_description: "Percentage — bad sum",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "percentage",
    p_splits: [
      { member_id: ownerMemberId, value: 50 },
      { member_id: memberMemberId, value: 40 },
    ],
  });
  ok(
    "percentage split: percentages not summing to 100 are rejected",
    Boolean(pctBadErr) && /100/.test(pctBadErr?.message ?? ""),
    pctBadErr?.message ?? "",
  );

  const { data: pctExpenseId, error: pctOkErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 999,
    p_description: "Percentage — good, odd total (rounding)",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "percentage",
    p_splits: [
      { member_id: ownerMemberId, value: 33.33 },
      { member_id: memberMemberId, value: 66.67 },
    ],
  });
  ok("percentage split: a correctly-summed split is accepted", !pctOkErr, pctOkErr?.message ?? "");
  const { data: pctParts } = await admin
    .from("expense_participants")
    .select("share_amount")
    .eq("expense_id", pctExpenseId);
  const pctSum = (pctParts ?? []).reduce((s, p) => s + Number(p.share_amount), 0);
  ok(
    "percentage split: paise-rounded shares still sum exactly to the total (largest-remainder method)",
    pctSum === 999,
    `sum=${pctSum}`,
  );

  // ── 4. shares split ───────────────────────────────────────────────────
  const { error: sharesZeroErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 300,
    p_description: "Shares — zero share",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "shares",
    p_splits: [
      { member_id: ownerMemberId, value: 1 },
      { member_id: memberMemberId, value: 0 },
    ],
  });
  ok(
    "shares split: a zero share count is rejected",
    Boolean(sharesZeroErr) && /greater than zero/i.test(sharesZeroErr?.message ?? ""),
    sharesZeroErr?.message ?? "",
  );

  const { data: sharesExpenseId, error: sharesOkErr } = await owner.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: ownerMemberId,
    p_amount: 300,
    p_description: "Shares — 1:2 split",
    p_participant_ids: [ownerMemberId, memberMemberId],
    p_split_type: "shares",
    p_splits: [
      { member_id: ownerMemberId, value: 1 },
      { member_id: memberMemberId, value: 2 },
    ],
  });
  ok("shares split: positive share counts are accepted", !sharesOkErr, sharesOkErr?.message ?? "");
  const { data: sharesParts } = await admin
    .from("expense_participants")
    .select("member_id, share_amount")
    .eq("expense_id", sharesExpenseId);
  ok(
    "shares split: 1:2 share ratio produces a 100:200 rupee split",
    sharesParts?.find((p) => p.member_id === ownerMemberId)?.share_amount == 100 &&
      sharesParts?.find((p) => p.member_id === memberMemberId)?.share_amount == 200,
  );

  // ── 5. edit_expense permissions ───────────────────────────────────────
  const { error: memberEditsOwnerExpenseErr } = await member.rpc("edit_expense", {
    p_expense_id: equalExpenseId,
    p_description: "Hijacked",
    p_amount: 1,
    p_paid_by: memberMemberId,
    p_participant_ids: [memberMemberId],
  });
  ok(
    "a non-creator, non-owner member cannot edit someone else's expense",
    Boolean(memberEditsOwnerExpenseErr) && /can edit it/i.test(memberEditsOwnerExpenseErr?.message ?? ""),
    memberEditsOwnerExpenseErr?.message ?? "",
  );

  const { data: memberExpenseId, error: memberAddErr } = await member.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: memberMemberId,
    p_amount: 200,
    p_description: "Member's own snack",
    p_participant_ids: [memberMemberId],
    p_split_type: "equal",
  });
  ok("a regular member can add their own expense", !memberAddErr, memberAddErr?.message ?? "");

  const { error: memberEditsOwnErr } = await member.rpc("edit_expense", {
    p_expense_id: memberExpenseId,
    p_description: "Member's own snack (edited)",
    p_amount: 250,
    p_paid_by: memberMemberId,
    p_participant_ids: [memberMemberId],
  });
  ok("a member can edit their own expense", !memberEditsOwnErr, memberEditsOwnErr?.message ?? "");

  const { error: ownerEditsMemberExpenseErr } = await owner.rpc("edit_expense", {
    p_expense_id: memberExpenseId,
    p_description: "Owner override edit",
    p_amount: 250,
    p_paid_by: memberMemberId,
    p_participant_ids: [memberMemberId],
  });
  ok("the trip owner can edit any member's expense", !ownerEditsMemberExpenseErr, ownerEditsMemberExpenseErr?.message ?? "");

  // ── 6. soft-delete permissions (RLS: creator or owner only) ────────────
  const { error: memberDeletesOwnerExpenseErr, data: memberDeleteResult } = await member
    .from("expenses")
    .update({ deleted_at: new Date().toISOString(), deletion_reason: "e2e" })
    .eq("id", equalExpenseId)
    .select();
  ok(
    "a non-creator, non-owner member cannot delete someone else's expense (RLS)",
    !memberDeletesOwnerExpenseErr && (memberDeleteResult ?? []).length === 0,
    memberDeletesOwnerExpenseErr?.message ?? `rows affected: ${memberDeleteResult?.length}`,
  );

  const { error: memberDeletesOwnErr, data: memberDeleteOwnResult } = await member
    .from("expenses")
    .update({ deleted_at: new Date().toISOString(), deletion_reason: "e2e" })
    .eq("id", memberExpenseId)
    .select();
  ok(
    "a member can delete their own expense",
    !memberDeletesOwnErr && (memberDeleteOwnResult ?? []).length === 1,
    memberDeletesOwnErr?.message ?? "",
  );

  // ── 7. settlements ───────────────────────────────────────────────────
  const { error: strangerSettleErr } = await stranger.rpc("record_settlement", {
    p_trip_id: tripId,
    p_from_member_id: memberMemberId,
    p_to_member_id: ownerMemberId,
    p_amount: 100,
  });
  ok("a non-member cannot record a settlement on this trip", Boolean(strangerSettleErr), strangerSettleErr?.message ?? "");

  const { data: settlementId, error: settleErr } = await member.rpc("record_settlement", {
    p_trip_id: tripId,
    p_from_member_id: memberMemberId,
    p_to_member_id: ownerMemberId,
    p_amount: 150,
    p_note: "e2e settlement",
  });
  ok("a trip member can record a settlement", !settleErr && typeof settlementId === "string", settleErr?.message ?? "");

  const { data: strangerSettlementsRead } = await stranger
    .from("settlements")
    .select("id")
    .eq("trip_id", tripId);
  ok("a non-member cannot read this trip's settlements (RLS)", (strangerSettlementsRead ?? []).length === 0);

  const { data: memberSettlementsRead } = await member.from("settlements").select("id").eq("trip_id", tripId);
  ok(
    "a trip member can read the trip's settlements",
    (memberSettlementsRead ?? []).some((s) => s.id === settlementId),
  );

  // ── 8. activity log (triggers) + RLS ────────────────────────────────────
  const { data: ownerActivity } = await owner
    .from("activity_log")
    .select("action, description")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  ok(
    "activity_log has an entry for the equal-split expense",
    (ownerActivity ?? []).some((a) => /added/i.test(a.description) && /Equal dinner/i.test(a.description)),
  );
  ok(
    "activity_log has an entry for the settlement",
    (ownerActivity ?? []).some((a) => a.action === "settlement_recorded" || /settled/i.test(a.description)),
  );

  const { data: strangerActivity } = await stranger.from("activity_log").select("id").eq("trip_id", tripId);
  ok("a non-member cannot read this trip's activity log (RLS)", (strangerActivity ?? []).length === 0);

  const { error: directTriggerCallErr } = await member.rpc("log_expense_activity");
  ok(
    "the activity-log trigger function cannot be called directly via RPC",
    Boolean(directTriggerCallErr),
    directTriggerCallErr?.message ?? "",
  );

  // ── 9. RLS isolation: a stranger cannot read this trip's expenses ──────
  const { data: strangerExpenses } = await stranger.from("expenses").select("id").eq("trip_id", tripId);
  ok("a non-member cannot read this trip's expenses (RLS)", (strangerExpenses ?? []).length === 0);

  // ── 10. trip description (owner-only column grant) ─────────────────────
  const { error: memberDescErr, data: memberDescResult } = await member
    .from("trips")
    .update({ description: "hijacked" })
    .eq("id", tripId)
    .select();
  ok(
    "a non-owner member cannot change the trip description (RLS)",
    !memberDescErr && (memberDescResult ?? []).length === 0,
  );

  const { error: ownerDescErr } = await owner.from("trips").update({ description: "E2E trip description" }).eq("id", tripId);
  ok("the owner can change the trip description", !ownerDescErr, ownerDescErr?.message ?? "");

  // ── 11. transfer ownership ──────────────────────────────────────────────
  const { error: memberTransferErr } = await member.rpc("transfer_trip_ownership", {
    p_trip_id: tripId,
    p_new_owner_member_id: memberMemberId,
  });
  ok("a non-owner cannot transfer ownership", Boolean(memberTransferErr), memberTransferErr?.message ?? "");

  const { error: transferErr } = await owner.rpc("transfer_trip_ownership", {
    p_trip_id: tripId,
    p_new_owner_member_id: memberMemberId,
  });
  ok("the owner can transfer ownership to another active member", !transferErr, transferErr?.message ?? "");

  const { data: rolesAfterTransfer } = await admin
    .from("trip_members")
    .select("member_id, role")
    .eq("trip_id", tripId);
  const newOwnerRow = rolesAfterTransfer?.find((r) => r.member_id === memberMemberId);
  const oldOwnerRow = rolesAfterTransfer?.find((r) => r.member_id === ownerMemberId);
  ok(
    "ownership actually moved: new owner is 'owner', old owner is now 'member'",
    newOwnerRow?.role === "owner" && oldOwnerRow?.role === "member",
  );

  // ── 12. leave trip ──────────────────────────────────────────────────────
  const { error: soleOwnerLeaveErr } = await member.rpc("leave_trip", { p_trip_id: tripId });
  ok(
    "the sole owner cannot leave without transferring ownership first",
    Boolean(soleOwnerLeaveErr) && /only owner/i.test(soleOwnerLeaveErr?.message ?? ""),
    soleOwnerLeaveErr?.message ?? "",
  );

  const { error: oldOwnerLeaveErr } = await owner.rpc("leave_trip", { p_trip_id: tripId });
  ok("a regular (non-sole-owner) member can leave the trip", !oldOwnerLeaveErr, oldOwnerLeaveErr?.message ?? "");

  const { data: oldOwnerTm } = await admin
    .from("trip_members")
    .select("is_active")
    .eq("trip_id", tripId)
    .eq("member_id", ownerMemberId)
    .single();
  ok("leaving deactivates the trip_members row, not deletes it", oldOwnerTm?.is_active === false);

  // ── 13. delete trip (owner-only, hard delete, atomic) ───────────────────
  const { error: strangerDeleteErr } = await stranger.rpc("delete_trip", { p_trip_id: tripId });
  ok("a non-member cannot delete the trip", Boolean(strangerDeleteErr), strangerDeleteErr?.message ?? "");

  const { error: deleteErr } = await member.rpc("delete_trip", { p_trip_id: tripId });
  ok("the (new) owner can delete the trip", !deleteErr, deleteErr?.message ?? "");

  const [{ data: tripAfter }, { data: expensesAfter }, { data: membersAfter }] = await Promise.all([
    admin.from("trips").select("id").eq("id", tripId),
    admin.from("expenses").select("id").eq("trip_id", tripId),
    admin.from("trip_members").select("id").eq("trip_id", tripId),
  ]);
  ok(
    "delete_trip actually removes the trip and everything under it",
    (tripAfter ?? []).length === 0 && (expensesAfter ?? []).length === 0 && (membersAfter ?? []).length === 0,
  );

  await owner.auth.signOut();
  await member.auth.signOut();
  await stranger.auth.signOut();
} catch (err) {
  ok("UNEXPECTED ERROR", false, err.message);
} finally {
  try {
    if (tripId) {
      await admin.from("activity_log").delete().eq("trip_id", tripId);
      await admin.from("settlements").delete().eq("trip_id", tripId);
      await admin.from("invitations").delete().eq("trip_id", tripId);
      const { data: leftoverExpenses } = await admin.from("expenses").select("id").eq("trip_id", tripId);
      if (leftoverExpenses?.length) {
        await admin
          .from("expense_participants")
          .delete()
          .in("expense_id", leftoverExpenses.map((e) => e.id));
        await admin.from("expenses").delete().eq("trip_id", tripId);
      }
      await admin.from("trip_members").delete().eq("trip_id", tripId);
      await admin.from("trips").delete().eq("id", tripId);
    }
    if (ownerMemberId) await admin.from("members").delete().eq("id", ownerMemberId);
    if (memberMemberId) await admin.from("members").delete().eq("id", memberMemberId);
    for (const uid of [ownerUserId, memberUserId, strangerUserId]) {
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
