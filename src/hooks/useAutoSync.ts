"use client";

import { useEffect } from "react";
import { syncPendingExpenses } from "@/lib/offlineSync";
import { useOnlineStatus } from "./useOnlineStatus";

/**
 * Fires an automatic sync attempt on the triggers the offline-queue spec
 * calls for: the browser's `online` event, the app returning to the
 * foreground, and a fresh sign-in (covered for free — `userId` flips from
 * null to a real id, re-running the effect). The two remaining triggers
 * are invoked from their own call sites: "Sync now" in the Offline Mode
 * UI, and immediately after reference data refreshes.
 *
 * Takes `userId` as an argument rather than reading `useSession()` itself,
 * specifically so this stays free of the Supabase SDK — that lets the
 * Offline Mode screens use it without dragging ~256 kB of auth code onto a
 * route that has no network to use it with. Callers that *do* have a live
 * session (see `AutoSyncTrigger`) pass it in.
 */
export function useAutoSync(userId: string | null) {
  const online = useOnlineStatus();

  useEffect(() => {
    if (!online || !userId) return;
    syncPendingExpenses(userId).catch(() => {});
  }, [online, userId]);

  useEffect(() => {
    if (!userId) return;
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && navigator.onLine && userId) {
        syncPendingExpenses(userId).catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [userId]);
}
