/**
 * End-to-end verification against the live Supabase project.
 *
 *   node --env-file=.env.local scripts/db-e2e.mjs
 *
 * Read-mostly: verifies the real Snehil identity mapping, RLS isolation,
 * and the ₹900 baseline without touching them. Write-path checks (trip
 * creation, guest members, expenses, cross-trip validation) run inside a
 * disposable test account + test trip that are fully removed afterwards.
 * Never prints secrets or tokens; requires SUPABASE_SECRET_KEY locally.
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

const REAL_EMAIL = "snehilrai678.sr@gmail.com";
const DEFAULT_TRIP = "0deff4ed-996a-454c-a66a-3a0993eb83b0";
const SNEHIL_MEMBER = "d74c76c8-deb2-4a10-84d5-b9966b13a528";

const results = [];
const ok = (name, pass, note = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

async function sessionFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;
  const client = createClient(url, pub, { auth: { persistSession: false } });
  const { error: vErr } = await client.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (vErr) throw vErr;
  return client;
}

let testUserId, testTripId, guestId, testExpenseId, testMemberId;
try {
  // ── Real identity mapping (read-only) ────────────────────────────────────
  const snehil = await sessionFor(REAL_EMAIL);
  ok("1. Snehil login (magic-link token → session)", true);

  const { data: trips, error: tErr } = await snehil.from("trips").select("id,name");
  ok("2. Snehil sees Default Trip", !tErr && trips?.some((t) => t.id === DEFAULT_TRIP), tErr?.message ?? "");

  const { data: roster, error: rErr } = await snehil
    .from("trip_members")
    .select("role, is_active, members(id,name,user_id)")
    .eq("trip_id", DEFAULT_TRIP);
  const me = roster?.find((r) => r.members?.user_id != null);
  ok("3. authenticated identity resolves to Snehil (never array position)", !rErr && me?.members?.id === SNEHIL_MEMBER && me?.members?.name === "Snehil", rErr?.message ?? "");
  ok("4. owner role on Default Trip", me?.role === "owner");
  ok("no duplicate Snehil", roster?.filter((r) => r.members?.name === "Snehil").length === 1);

  const { data: expenses } = await snehil
    .from("expenses")
    .select("id, amount, paid_by, expense_participants(member_id, share_amount)")
    .eq("trip_id", DEFAULT_TRIP)
    .is("deleted_at", null);
  const dinner = expenses?.find((e) => Number(e.amount) === 900);
  ok("5. ₹900 expense remains, paid by Snehil", dinner?.paid_by === SNEHIL_MEMBER);

  // 6. Balance math on the real data
  const paid = {}, share = {};
  for (const e of expenses ?? []) {
    paid[e.paid_by] = (paid[e.paid_by] ?? 0) + Number(e.amount);
    for (const p of e.expense_participants) {
      share[p.member_id] = (share[p.member_id] ?? 0) + Number(p.share_amount);
    }
  }
  const net = (id) => (paid[id] ?? 0) - (share[id] ?? 0);
  const others = Object.keys(share).filter((id) => id !== SNEHIL_MEMBER);
  ok(
    "6. balances: Snehil +600, each other member −300",
    net(SNEHIL_MEMBER) === 600 && others.length === 2 && others.every((id) => net(id) === -300),
    `snehil=${net(SNEHIL_MEMBER)}`,
  );

  // ── Multi-trip write path in a disposable sandbox ────────────────────────
  const testEmail = `splitzy-e2e-${Date.now()}@example.com`;
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: testEmail,
    email_confirm: true,
  });
  if (cErr) throw cErr;
  testUserId = created.user.id;
  const tester = await sessionFor(testEmail);

  // 13. New user with no trips: reads are denied (UI maps this to onboarding)
  const { data: none, error: noneErr } = await tester.from("trips").select("id");
  ok("13. new user has no trip access (onboarding state, not a crash)", (none ?? []).length === 0, noneErr?.message ?? "rows=0");

  const { data: newTripId, error: ctErr } = await tester.rpc("create_trip", {
    p_name: "E2E Trip",
    p_member_name: "E2E Tester",
  });
  if (ctErr) throw ctErr;
  testTripId = newTripId;
  ok("7. create a second (test) trip via RPC", Boolean(testTripId));

  const { data: myTrips } = await tester.from("trips").select("id");
  ok("8. trip switching data: tester sees exactly their own trip", myTrips?.length === 1 && myTrips[0].id === testTripId);

  const { data: gid, error: gErr } = await tester.rpc("add_guest_member", {
    p_trip_id: testTripId,
    p_name: `E2E Guest ${Date.now()}`,
  });
  if (gErr) throw gErr;
  guestId = gid;
  ok("9. add a guest member", Boolean(guestId));

  const { data: tm } = await tester.from("trip_members").select("member_id, role").eq("trip_id", testTripId);
  testMemberId = tm?.find((r) => r.role === "owner")?.member_id;
  const { data: expId, error: eErr } = await tester.rpc("add_expense", {
    p_trip_id: testTripId,
    p_paid_by: testMemberId,
    p_amount: 101,
    p_description: "E2E expense",
    p_participant_ids: [testMemberId, guestId],
  });
  if (eErr) throw eErr;
  testExpenseId = expId;
  const { data: shares } = await tester.from("expense_participants").select("share_amount").eq("expense_id", testExpenseId);
  const sum = shares.reduce((s, r) => s + Number(r.share_amount), 0);
  ok("10. expense in second trip, paise-exact split", Math.abs(sum - 101) < 0.001, `sum=${sum}`);

  // 11 + 14. Isolation both directions
  const { data: leak } = await tester.from("expenses").select("id").eq("trip_id", DEFAULT_TRIP);
  ok("14. tester cannot read Default Trip expenses", (leak ?? []).length === 0);
  const { error: crossErr } = await tester.rpc("add_expense", {
    p_trip_id: DEFAULT_TRIP,
    p_paid_by: testMemberId,
    p_amount: 5,
    p_description: "cross-trip attack",
    p_participant_ids: [testMemberId],
  });
  ok("cross-trip expense rejected", Boolean(crossErr), crossErr?.message ?? "");
  const { data: snehilLeak } = await snehil.from("expenses").select("id").eq("trip_id", testTripId);
  ok("11. no leakage: Snehil cannot see the test trip's expenses", (snehilLeak ?? []).length === 0);

  // 12. Logout
  const { error: soErr } = await tester.auth.signOut();
  const { error: sn } = await snehil.auth.signOut();
  ok("12. logout works for both sessions", !soErr && !sn);

  // Anonymous lockout
  const { data: anonTrips, error: anonErr } = await anon.from("trips").select("id");
  ok("anonymous users see nothing", (anonTrips ?? []).length === 0, anonErr?.message ?? "");
} catch (err) {
  ok("UNEXPECTED ERROR", false, err.message);
} finally {
  // Remove only clearly-marked test artifacts; never Default Trip data.
  try {
    if (testExpenseId) {
      await admin.from("expense_participants").delete().eq("expense_id", testExpenseId);
      await admin.from("expenses").delete().eq("id", testExpenseId);
    }
    if (testTripId) {
      await admin.from("trip_members").delete().eq("trip_id", testTripId);
      await admin.from("invitations").delete().eq("trip_id", testTripId);
      await admin.from("trips").delete().eq("id", testTripId);
    }
    if (testMemberId) await admin.from("members").delete().eq("id", testMemberId);
    if (guestId) await admin.from("members").delete().eq("id", guestId);
    if (testUserId) await admin.auth.admin.deleteUser(testUserId);
    console.log("cleanup: test artifacts removed");
  } catch (e) {
    console.log("cleanup error:", e.message);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
