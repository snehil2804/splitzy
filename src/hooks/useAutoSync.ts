"use client";

import { useEffect } from "react";
import { syncPendingExpenses } from "@/lib/offlineSync";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSession } from "./useSession";

/**
 * Fires an automatic sync attempt on every trigger the offline-queue spec
 * calls for except two that are triggered from their own call sites
 * ("Sync now" in the Offline Mode UI, and right after reference data is
 * refreshed in `OfflineCacheWarmer`): the browser's `online` event, the app
 * being opened, the app returning to the foreground, and a fresh sign-in
 * (covered for free — `userId` flips from null to a real id, re-running the
 * effect below).
 */
export function useAutoSync() {
  const online = useOnlineStatus();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

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
