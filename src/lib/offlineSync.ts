import { refreshOfflineQueue } from "@/hooks/useOfflineQueue";
import {
  deleteOfflineExpense,
  getOfflineExpense,
  getSyncMetadata,
  listOfflineExpensesForUser,
  saveOfflineExpense,
  setSyncMetadata,
} from "./offlineDb";
import type { OfflineExpense } from "./offlineTypes";

/**
 * Processes the offline queue against `POST /api/expenses/sync`, one
 * record at a time. A record is only ever removed from IndexedDB after the
 * server confirms it — a failed sync keeps the record, with a
 * human-readable error, so nothing valid is ever silently lost or blocked
 * by one bad item.
 */

/** Automatic (non-manual) triggers stop retrying a record after this many
 *  failed attempts — "Sync now" always retries regardless, since that's an
 *  explicit user action, not a background poll. */
const MAX_AUTOMATIC_ATTEMPTS = 5;

interface SyncOptions {
  manual?: boolean;
}

interface SyncResult {
  syncedCount: number;
  failedCount: number;
}

async function syncOne(expense: OfflineExpense): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/expenses/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: expense.idempotency_key,
        tripId: expense.trip_id,
        paidByMemberId: expense.paid_by_member_id,
        amount: expense.amount,
        description: expense.description,
        participantIds: expense.participant_ids,
        paymentApp: expense.payment_app_or_method,
        paidAt: expense.paid_at,
        locationName: expense.manual_location_name,
        latitude: expense.latitude,
        longitude: expense.longitude,
        notes: expense.notes,
      }),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Couldn't sync that expense. Please try again.";
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server — check your connection and try again." };
  }
}

async function runSyncPass(userId: string, options: SyncOptions): Promise<SyncResult> {
  const metadata = await getSyncMetadata();
  // Cross-tab guard (best-effort — IndexedDB is shared, JS module state
  // isn't). The idempotency key is the real backstop against a duplicate
  // ever landing in the database even if two tabs briefly race here.
  if (metadata.sync_in_progress) return { syncedCount: 0, failedCount: 0 };

  await setSyncMetadata({ sync_in_progress: true, last_sync_attempt_at: new Date().toISOString() });

  let syncedCount = 0;
  let failedCount = 0;
  try {
    const queue = await listOfflineExpensesForUser(userId);
    const retryable = queue.filter(
      (e) =>
        e.sync_status === "pending" ||
        (e.sync_status === "failed" && (options.manual || e.sync_attempt_count < MAX_AUTOMATIC_ATTEMPTS)),
    );

    for (const item of retryable) {
      // Re-read right before sending — the record may have been edited,
      // deleted, or already synced by another trigger since the list load.
      const current = await getOfflineExpense(item.local_id);
      if (!current || current.sync_status === "synced" || current.sync_status === "syncing") continue;

      await saveOfflineExpense({ ...current, sync_status: "syncing" });
      await refreshOfflineQueue(userId);

      const result = await syncOne(current);
      if (result.ok) {
        await deleteOfflineExpense(current.local_id);
        syncedCount++;
      } else {
        await saveOfflineExpense({
          ...current,
          sync_status: "failed",
          sync_attempt_count: current.sync_attempt_count + 1,
          last_sync_error: result.error,
        });
        failedCount++;
      }
      await refreshOfflineQueue(userId);
    }
  } finally {
    await setSyncMetadata({
      sync_in_progress: false,
      last_sync_success_at: syncedCount > 0 ? new Date().toISOString() : metadata.last_sync_success_at,
    });
  }

  return { syncedCount, failedCount };
}

let inFlight: Promise<SyncResult> | null = null;

/** Never runs two overlapping passes within this tab; best-effort across tabs via Web Locks. */
export async function syncPendingExpenses(userId: string, options: SyncOptions = {}): Promise<SyncResult> {
  if (inFlight) return inFlight;

  const start = () => {
    inFlight = runSyncPass(userId, options).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request("splitzy-offline-sync", () => start());
  }
  return start();
}
