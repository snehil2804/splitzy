import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  __resetForTests,
  deleteOfflineExpense,
  getLatestReferenceDataForUser,
  getMostRecentCachedUserId,
  getOfflineExpense,
  getReferenceData,
  getSyncMetadata,
  hasQueuedExpensesForOtherUser,
  listOfflineExpensesForUser,
  saveOfflineExpense,
  saveReferenceData,
  setSyncMetadata,
} from "../src/lib/offlineDb";
import type { OfflineExpense, OfflineReferenceData } from "../src/lib/offlineTypes";

before(() => __resetForTests());

function expense(overrides: Partial<OfflineExpense> = {}): OfflineExpense {
  const now = new Date().toISOString();
  return {
    local_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    trip_id: "trip-1",
    trip_name: "Test Trip",
    created_by_user_id: "user-a",
    created_by_display_name: "Alex",
    paid_by_member_id: "member-1",
    paid_by_name: "Alex",
    amount: 100,
    currency: "INR",
    description: "Tea",
    participant_ids: ["member-1"],
    participant_names: ["Alex"],
    participant_count: 1,
    share_per_person: 100,
    split_method: "equal",
    payment_app_or_method: "Cash",
    paid_at: now,
    manual_location_name: null,
    latitude: null,
    longitude: null,
    notes: null,
    created_offline_at: now,
    updated_offline_at: now,
    sync_status: "pending",
    sync_attempt_count: 0,
    last_sync_error: null,
    synced_expense_id: null,
    ...overrides,
  };
}

test("an offline expense can be saved and read back exactly", async () => {
  const e = expense({ description: "Roadside chai" });
  await saveOfflineExpense(e);
  const fetched = await getOfflineExpense(e.local_id);
  assert.deepEqual(fetched, e);
});

test("listOfflineExpensesForUser only ever returns that user's own records", async () => {
  const mine = expense({ created_by_user_id: "user-list-a", trip_id: "trip-list" });
  const someoneElses = expense({ created_by_user_id: "user-list-b", trip_id: "trip-list" });
  await saveOfflineExpense(mine);
  await saveOfflineExpense(someoneElses);

  const listA = await listOfflineExpensesForUser("user-list-a");
  const listB = await listOfflineExpensesForUser("user-list-b");

  assert.ok(listA.some((e) => e.local_id === mine.local_id));
  assert.ok(!listA.some((e) => e.local_id === someoneElses.local_id));
  assert.ok(listB.some((e) => e.local_id === someoneElses.local_id));
  assert.ok(!listB.some((e) => e.local_id === mine.local_id));
});

// `hasQueuedExpensesForOtherUser` deliberately checks across the *entire*
// store, not one trip — its whole purpose is catching any other account's
// data anywhere on the device. That means these two checks need a truly
// empty store to test the "false" branch meaningfully; a shared-file reset
// wouldn't be enough once earlier tests have already inserted other users'
// pending fixtures, so each resets independently right before it runs.

test("hasQueuedExpensesForOtherUser detects another account's unsynced queue but not this one's", async () => {
  await __resetForTests();
  const userId = "user-iso-current";
  const otherId = "user-iso-other";
  await saveOfflineExpense(expense({ created_by_user_id: userId, trip_id: "trip-iso", sync_status: "pending" }));
  assert.equal(await hasQueuedExpensesForOtherUser(userId), false);

  await saveOfflineExpense(expense({ created_by_user_id: otherId, trip_id: "trip-iso", sync_status: "pending" }));
  assert.equal(await hasQueuedExpensesForOtherUser(userId), true);
});

test("a synced record for another user doesn't count as 'queued'", async () => {
  await __resetForTests();
  const userId = "user-synced-check";
  const otherId = "user-synced-other";
  await saveOfflineExpense(
    expense({ created_by_user_id: otherId, trip_id: "trip-synced", sync_status: "synced" }),
  );
  assert.equal(await hasQueuedExpensesForOtherUser(userId), false);
});

test("deleteOfflineExpense removes the record", async () => {
  const e = expense();
  await saveOfflineExpense(e);
  assert.ok(await getOfflineExpense(e.local_id));
  await deleteOfflineExpense(e.local_id);
  assert.equal(await getOfflineExpense(e.local_id), undefined);
});

test("editing an offline expense preserves its idempotency key while updating fields", async () => {
  const e = expense({ description: "Original" });
  await saveOfflineExpense(e);
  const edited: OfflineExpense = { ...e, description: "Edited", amount: 250 };
  await saveOfflineExpense(edited);

  const fetched = await getOfflineExpense(e.local_id);
  assert.equal(fetched?.description, "Edited");
  assert.equal(fetched?.amount, 250);
  assert.equal(fetched?.idempotency_key, e.idempotency_key);
});

function referenceData(overrides: Partial<OfflineReferenceData> = {}): OfflineReferenceData {
  return {
    trip_id: "ref-trip-1",
    trip_name: "Ref Trip",
    user_id: "ref-user-1",
    user_display_name: "Alex",
    members: [{ id: "member-1", name: "Alex" }],
    default_currency: "INR",
    payment_methods: ["Cash", "GPay"],
    cached_at: new Date().toISOString(),
    ...overrides,
  };
}

test("reference data round-trips and getLatestReferenceDataForUser picks the newest", async () => {
  const older = referenceData({
    trip_id: "ref-older",
    user_id: "ref-latest-user",
    cached_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const newer = referenceData({
    trip_id: "ref-newer",
    user_id: "ref-latest-user",
    cached_at: new Date().toISOString(),
  });
  await saveReferenceData(older);
  await saveReferenceData(newer);

  assert.deepEqual(await getReferenceData("ref-newer"), newer);
  const latest = await getLatestReferenceDataForUser("ref-latest-user");
  assert.equal(latest?.trip_id, "ref-newer");
});

test("getMostRecentCachedUserId returns the user behind whichever cache entry is newest", async () => {
  await __resetForTests();
  await saveReferenceData(
    referenceData({
      trip_id: "recent-a",
      user_id: "user-recent-a",
      cached_at: new Date(Date.now() - 60_000).toISOString(),
    }),
  );
  await saveReferenceData(
    referenceData({
      trip_id: "recent-b",
      user_id: "user-recent-b",
      cached_at: new Date().toISOString(),
    }),
  );

  assert.equal(await getMostRecentCachedUserId(), "user-recent-b");
});

test("getMostRecentCachedUserId returns null when nothing has ever been cached", async () => {
  await __resetForTests();
  assert.equal(await getMostRecentCachedUserId(), null);
});

test("sync metadata defaults sensibly, then persists updates", async () => {
  const initial = await getSyncMetadata();
  assert.equal(initial.sync_in_progress, false);

  await setSyncMetadata({ sync_in_progress: true, last_sync_attempt_at: "2026-01-01T00:00:00.000Z" });
  const updated = await getSyncMetadata();
  assert.equal(updated.sync_in_progress, true);
  assert.equal(updated.last_sync_attempt_at, "2026-01-01T00:00:00.000Z");

  // Updates merge — an omitted field must not be clobbered back to null.
  await setSyncMetadata({ sync_in_progress: false });
  const after = await getSyncMetadata();
  assert.equal(after.sync_in_progress, false);
  assert.equal(after.last_sync_attempt_at, "2026-01-01T00:00:00.000Z");
});
