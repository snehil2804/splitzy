import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { OfflineExpense, OfflineReferenceData, OfflineSyncMetadata } from "./offlineTypes";

/**
 * IndexedDB storage for the offline expense queue. Three stores, exactly as
 * scoped: queued expenses, cached reference data (trip/members needed to
 * build the offline form), and sync-process bookkeeping. Never
 * `localStorage` — these records can be many, need indexed lookup by user
 * and status, and must survive far larger volumes than localStorage's
 * practical limits comfortably allow.
 *
 * Every read that returns expense data is scoped by `created_by_user_id` —
 * there is deliberately no "list everything" export, so a shared-device
 * multi-account scenario can never leak one user's queue into another's view.
 */

interface OfflineSchema extends DBSchema {
  offline_expenses: {
    key: string;
    value: OfflineExpense;
    indexes: { by_user: string; by_status: string };
  };
  offline_reference_data: {
    key: string;
    value: OfflineReferenceData;
  };
  offline_sync_metadata: {
    key: string;
    value: OfflineSyncMetadata;
  };
}

const DB_NAME = "splitzy-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineSchema>> | null = null;

/**
 * Test-only: closes the cached connection and deletes the underlying
 * database, so each test file/group can start from a clean slate. Never
 * called by app code.
 */
export async function __resetForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function getDb(): Promise<IDBPDatabase<OfflineSchema>> {
  dbPromise ??= openDB<OfflineSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const expenses = db.createObjectStore("offline_expenses", { keyPath: "local_id" });
      expenses.createIndex("by_user", "created_by_user_id");
      expenses.createIndex("by_status", "sync_status");
      db.createObjectStore("offline_reference_data", { keyPath: "trip_id" });
      db.createObjectStore("offline_sync_metadata", { keyPath: "key" });
    },
  });
  return dbPromise;
}

// ── Offline expenses ─────────────────────────────────────────────────────────

export async function saveOfflineExpense(expense: OfflineExpense): Promise<void> {
  const db = await getDb();
  await db.put("offline_expenses", expense);
}

export async function getOfflineExpense(localId: string): Promise<OfflineExpense | undefined> {
  const db = await getDb();
  return db.get("offline_expenses", localId);
}

/** The only listing export — always scoped to the currently authenticated user. */
export async function listOfflineExpensesForUser(userId: string): Promise<OfflineExpense[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("offline_expenses", "by_user", userId);
  return all.sort((a, b) => b.created_offline_at.localeCompare(a.created_offline_at));
}

export async function deleteOfflineExpense(localId: string): Promise<void> {
  const db = await getDb();
  await db.delete("offline_expenses", localId);
}

/** Whether any other account has unsynced records queued on this device. */
export async function hasQueuedExpensesForOtherUser(currentUserId: string): Promise<boolean> {
  const db = await getDb();
  const all = await db.getAll("offline_expenses");
  return all.some(
    (e) => e.created_by_user_id !== currentUserId && e.sync_status !== "synced",
  );
}

// ── Reference data ───────────────────────────────────────────────────────────

export async function saveReferenceData(data: OfflineReferenceData): Promise<void> {
  const db = await getDb();
  await db.put("offline_reference_data", data);
}

export async function getReferenceData(tripId: string): Promise<OfflineReferenceData | undefined> {
  const db = await getDb();
  return db.get("offline_reference_data", tripId);
}

/** Most recently cached reference data for this user, regardless of trip id. */
export async function getLatestReferenceDataForUser(
  userId: string,
): Promise<OfflineReferenceData | undefined> {
  const db = await getDb();
  const all = await db.getAll("offline_reference_data");
  const mine = all.filter((r) => r.user_id === userId);
  mine.sort((a, b) => b.cached_at.localeCompare(a.cached_at));
  return mine[0];
}

/**
 * The `user_id` from whichever cached reference data was written most
 * recently on this device — a network-free fallback for "who is signed in"
 * when the live session hasn't resolved. Never used to list or sync expense
 * data itself; every read of that still goes through the userId-scoped
 * functions above.
 */
export async function getMostRecentCachedUserId(): Promise<string | null> {
  const db = await getDb();
  const all = await db.getAll("offline_reference_data");
  if (all.length === 0) return null;
  all.sort((a, b) => b.cached_at.localeCompare(a.cached_at));
  return all[0].user_id;
}

/**
 * Resolves "who is signed in on this device" and "what does the offline
 * form need" from a **single** scan of the reference-data store.
 *
 * These used to be two separate full scans run strictly in sequence
 * (identity first, then reference data keyed by the identity it returned),
 * which meant Offline Mode couldn't paint until two IndexedDB round-trips
 * had completed — noticeably slow on a phone, where the first open of the
 * database is itself not cheap.
 *
 * `sessionUserId` is the confirmed live session's user when there is one.
 * Passing `null` opts into the cached-identity fallback: the most recently
 * cached account on this device wins. Callers must only do that when the
 * session is genuinely indeterminate — never when it has positively
 * resolved to signed-out.
 */
export async function loadIdentityAndReference(
  sessionUserId: string | null,
): Promise<{ userId: string | null; reference: OfflineReferenceData | null }> {
  const db = await getDb();
  const all = await db.getAll("offline_reference_data");
  if (all.length === 0) return { userId: sessionUserId, reference: null };
  // Newest first, so the `find` below picks this user's freshest entry.
  all.sort((a, b) => b.cached_at.localeCompare(a.cached_at));
  const userId = sessionUserId ?? all[0].user_id;
  return { userId, reference: all.find((r) => r.user_id === userId) ?? null };
}

// ── Sync metadata ────────────────────────────────────────────────────────────

const SYNC_METADATA_KEY = "global";

export async function getSyncMetadata(): Promise<OfflineSyncMetadata> {
  const db = await getDb();
  const existing = await db.get("offline_sync_metadata", SYNC_METADATA_KEY);
  return (
    existing ?? {
      key: SYNC_METADATA_KEY,
      last_sync_attempt_at: null,
      last_sync_success_at: null,
      sync_in_progress: false,
    }
  );
}

export async function setSyncMetadata(patch: Partial<OfflineSyncMetadata>): Promise<void> {
  const db = await getDb();
  const current = await getSyncMetadata();
  await db.put("offline_sync_metadata", { ...current, ...patch, key: SYNC_METADATA_KEY });
}
