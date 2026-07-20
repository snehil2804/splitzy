/**
 * Offline queue types — IndexedDB (`idb`) storage, never `localStorage`.
 * Everything here stays entirely client-side until a record reaches
 * `sync_status: "synced"`. See `offlineDb.ts` for the store definitions and
 * `src/app/api/expenses/sync/route.ts` for the server side of syncing.
 */

export type OfflineSyncStatus = "pending" | "syncing" | "failed" | "synced";

/** One expense captured while offline. `local_id` is the IndexedDB key. */
export interface OfflineExpense {
  local_id: string;
  /** Stable, generated once at creation — never regenerated, even on edit or retry. */
  idempotency_key: string;
  trip_id: string;
  trip_name: string;
  /** Whoever was authenticated on this device when the record was created — the
   *  only identity ever allowed to view, edit, delete, or sync this record. */
  created_by_user_id: string;
  created_by_display_name: string;
  paid_by_member_id: string;
  paid_by_name: string;
  amount: number;
  currency: string;
  description: string;
  participant_ids: string[];
  participant_names: string[];
  participant_count: number;
  share_per_person: number;
  /** Offline capture only ever supports equal splits — see product scope. */
  split_method: "equal";
  payment_app_or_method: string | null;
  /** ISO timestamp — when the user says the expense actually happened. */
  paid_at: string;
  manual_location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  /** ISO timestamps for the local record itself (distinct from `paid_at`). */
  created_offline_at: string;
  updated_offline_at: string;
  sync_status: OfflineSyncStatus;
  sync_attempt_count: number;
  last_sync_error: string | null;
  /** Set once the server confirms creation — lets the UI link to the real expense. */
  synced_expense_id: string | null;
}

/** Everything needed to build the offline expense form, cached once per trip while online. */
export interface OfflineReferenceData {
  trip_id: string;
  trip_name: string;
  user_id: string;
  user_display_name: string;
  members: Array<{ id: string; name: string }>;
  default_currency: string;
  payment_methods: string[];
  cached_at: string;
}

/** Singleton bookkeeping for the sync process itself — never expense data. */
export interface OfflineSyncMetadata {
  key: "global";
  last_sync_attempt_at: string | null;
  last_sync_success_at: string | null;
  sync_in_progress: boolean;
  /**
   * Auth user id of the account signed in on this device, or `null` when
   * explicitly signed out. Written by the online app (which has the
   * Supabase SDK loaded anyway); the offline screens read *only* this, so
   * they never have to pull the ~256 kB auth SDK onto their critical path
   * just to answer "who is this".
   *
   * Three distinct states matter, hence optional-and-nullable:
   *   `string`    — signed in as this user.
   *   `null`      — explicitly signed out; show nothing from the cache.
   *   `undefined` — never recorded (a device that last ran a build from
   *                 before this field existed). Falls back to the most
   *                 recently cached identity, which is what those devices
   *                 were already doing.
   */
  active_user_id?: string | null;
}
