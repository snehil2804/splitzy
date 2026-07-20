"use client";

import { useEffect, useState } from "react";
import { getActiveUserId, getMostRecentCachedUserId, loadIdentityAndReference } from "@/lib/offlineDb";
import type { OfflineReferenceData } from "@/lib/offlineTypes";

/**
 * Everything the Offline Mode screens need to render — who is signed in,
 * and the cached trip/member reference data for them — resolved purely from
 * IndexedDB.
 *
 * Deliberately does **not** touch `useSession()`. That would drag the
 * Supabase auth SDK (~256 kB, a quarter of this route's JS) onto the
 * critical path purely to call `getSession()`, which offline cannot
 * succeed at anyway: with the radios off its token refresh never settles,
 * which is what originally left this screen stuck on "Loading…" forever.
 * The online app records the signed-in user id into IndexedDB on every
 * session change instead, so the answer is already here, locally, for free.
 *
 * Identity and reference data come from a single scan of the store
 * (`loadIdentityAndReference`), so the screen paints after one IndexedDB
 * round-trip rather than several.
 */

type OfflineBootstrapStatus = "loading" | "ready" | "signed-out";

interface OfflineBootstrapResult {
  status: OfflineBootstrapStatus;
  userId: string | null;
  reference: OfflineReferenceData | null;
}

export function useOfflineBootstrap(): OfflineBootstrapResult {
  const [loaded, setLoaded] = useState<{
    userId: string | null;
    reference: OfflineReferenceData | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const activeUserId = await getActiveUserId();

      // Explicitly signed out: show nothing from the cache, even though
      // this device may still hold that account's queued expenses. (The
      // queue itself is never deleted — signing out must not destroy
      // unsynced work — it just isn't shown to a signed-out visitor.)
      if (activeUserId === null) {
        if (!cancelled) setLoaded({ userId: null, reference: null });
        return;
      }

      // `undefined` means this device predates the marker; fall back to the
      // most recently cached account, which is what it was already doing.
      const userId = activeUserId ?? (await getMostRecentCachedUserId());
      const result = await loadIdentityAndReference(userId);
      if (!cancelled) setLoaded(result);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return { status: "loading", userId: null, reference: null };
  if (!loaded.userId) return { status: "signed-out", userId: null, reference: null };
  return { status: "ready", userId: loaded.userId, reference: loaded.reference };
}
