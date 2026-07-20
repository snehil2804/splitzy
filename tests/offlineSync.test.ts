import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { __resetForTests, getOfflineExpense, saveOfflineExpense } from "../src/lib/offlineDb";
import { syncPendingExpenses } from "../src/lib/offlineSync";
import type { OfflineExpense } from "../src/lib/offlineTypes";

beforeEach(() => __resetForTests());

function expense(overrides: Partial<OfflineExpense> = {}): OfflineExpense {
  const now = new Date().toISOString();
  return {
    local_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    trip_id: "trip-1",
    trip_name: "Test Trip",
    created_by_user_id: "user-sync-test",
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

/** Installs a fetch mock for the duration of one test and restores the original after. */
function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("a successful sync removes the local record", async () => {
  const restore = mockFetch(async () => jsonResponse({ expenseId: "server-expense-1" }, 200));
  try {
    const e = expense();
    await saveOfflineExpense(e);

    const result = await syncPendingExpenses("user-sync-test");

    assert.equal(result.syncedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(await getOfflineExpense(e.local_id), undefined);
  } finally {
    restore();
  }
});

test("a failed sync keeps the record with a human-readable error, and increments the attempt count", async () => {
  const restore = mockFetch(async () =>
    jsonResponse({ error: "This trip is no longer available." }, 400),
  );
  try {
    const e = expense();
    await saveOfflineExpense(e);

    const result = await syncPendingExpenses("user-sync-test");

    assert.equal(result.syncedCount, 0);
    assert.equal(result.failedCount, 1);

    const stillThere = await getOfflineExpense(e.local_id);
    assert.ok(stillThere, "the record must not be deleted on failure");
    assert.equal(stillThere?.sync_status, "failed");
    assert.equal(stillThere?.sync_attempt_count, 1);
    assert.equal(stillThere?.last_sync_error, "This trip is no longer available.");
  } finally {
    restore();
  }
});

test("an auth-expiry-style failure keeps the queued record — it is never deleted", async () => {
  const restore = mockFetch(async () =>
    jsonResponse({ error: "Please reconnect and sign in before syncing." }, 401),
  );
  try {
    const e = expense();
    await saveOfflineExpense(e);

    await syncPendingExpenses("user-sync-test");

    const stillThere = await getOfflineExpense(e.local_id);
    assert.ok(stillThere);
    assert.equal(stillThere?.sync_status, "failed");
  } finally {
    restore();
  }
});

test("a network failure (offline mid-sync) also keeps the record, with a network-flavored message", async () => {
  const restore = mockFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  try {
    const e = expense();
    await saveOfflineExpense(e);

    await syncPendingExpenses("user-sync-test");

    const stillThere = await getOfflineExpense(e.local_id);
    assert.ok(stillThere);
    assert.equal(stillThere?.sync_status, "failed");
    assert.match(stillThere!.last_sync_error!, /connection/i);
  } finally {
    restore();
  }
});

test("multiple queued expenses are all processed, successes and failures independently", async () => {
  const restore = mockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.description === "Fails on purpose") {
      return jsonResponse({ error: "This expense needs review before it can sync." }, 400);
    }
    return jsonResponse({ expenseId: `server-${body.description}` }, 200);
  });
  try {
    const good1 = expense({ description: "Tea" });
    const good2 = expense({ description: "Coffee" });
    const bad = expense({ description: "Fails on purpose" });
    await saveOfflineExpense(good1);
    await saveOfflineExpense(good2);
    await saveOfflineExpense(bad);

    const result = await syncPendingExpenses("user-sync-test");

    assert.equal(result.syncedCount, 2);
    assert.equal(result.failedCount, 1);
    assert.equal(await getOfflineExpense(good1.local_id), undefined);
    assert.equal(await getOfflineExpense(good2.local_id), undefined);
    assert.ok(await getOfflineExpense(bad.local_id), "the one bad expense must not block the good ones");
  } finally {
    restore();
  }
});

test("an automatic sync stops retrying a record after too many failed attempts, but 'Sync now' still tries", async () => {
  const restore = mockFetch(async () => jsonResponse({ error: "Still broken." }, 400));
  try {
    const e = expense({ sync_status: "failed", sync_attempt_count: 5, last_sync_error: "Still broken." });
    await saveOfflineExpense(e);

    const automatic = await syncPendingExpenses("user-sync-test");
    assert.equal(automatic.syncedCount, 0);
    assert.equal(automatic.failedCount, 0, "an exhausted record should be skipped, not retried, automatically");

    const manual = await syncPendingExpenses("user-sync-test", { manual: true });
    assert.equal(manual.failedCount, 1, "'Sync now' must retry regardless of attempt count");
  } finally {
    restore();
  }
});

test("a sync never touches another user's queued expenses", async () => {
  const restore = mockFetch(async () => jsonResponse({ expenseId: "server-x" }, 200));
  try {
    const mine = expense({ created_by_user_id: "user-sync-test" });
    const someoneElses = expense({ created_by_user_id: "a-different-user" });
    await saveOfflineExpense(mine);
    await saveOfflineExpense(someoneElses);

    const result = await syncPendingExpenses("user-sync-test");

    assert.equal(result.syncedCount, 1);
    assert.equal(await getOfflineExpense(mine.local_id), undefined);
    const other = await getOfflineExpense(someoneElses.local_id);
    assert.ok(other, "another user's record must be completely untouched");
    assert.equal(other?.sync_status, "pending");
  } finally {
    restore();
  }
});
