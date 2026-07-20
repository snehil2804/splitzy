"use client";

import { useEffect, useState } from "react";
import { getMostRecentCachedUserId } from "@/lib/offlineDb";
import { useSession } from "./useSession";

/**
 * `useSession()`'s initial `getSession()` call can hang indefinitely while
 * offline: if the cached access token had already expired, the Supabase SDK
 * attempts a network refresh before resolving, and that request never
 * settles with both radios off (confirmed on a real device — a plain
 * `sessionStatus === "loading"` gate on the Offline Mode pages left the
 * user stuck on a permanent "Loading…" screen). This never blocks: once
 * `useSession()` genuinely settles (fast, on any normal load) it's
 * authoritative; if it's still "loading" after a short timeout, this falls
 * back to the most recently cached identity on *this* device — read from
 * IndexedDB, never the network — so Offline Mode stays usable even when
 * the live session can't be confirmed.
 */

const FALLBACK_TIMEOUT_MS = 2500;

type OfflineIdentityStatus = "loading" | "ready" | "signed-out";

interface OfflineIdentityResult {
  status: OfflineIdentityStatus;
  userId: string | null;
  /** True when `userId` came from the local cache, not a confirmed live session. */
  usingCachedIdentity: boolean;
}

export function useOfflineIdentity(): OfflineIdentityResult {
  const { status: sessionStatus, session } = useSession();
  const [fallbackUserId, setFallbackUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (sessionStatus !== "loading") return;
    // If the device already reports itself offline there is nothing to wait
    // for — `getSession()`'s token refresh cannot possibly succeed — so skip
    // straight to the cached identity instead of sitting on "Loading…" for
    // the full timeout.
    const alreadyOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (alreadyOffline) {
      let cancelled = false;
      getMostRecentCachedUserId().then((id) => {
        if (!cancelled) setFallbackUserId(id);
      });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => {
      getMostRecentCachedUserId().then(setFallbackUserId);
    }, FALLBACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [sessionStatus]);

  if (session?.user.id) {
    return { status: "ready", userId: session.user.id, usingCachedIdentity: false };
  }
  if (sessionStatus === "unauthenticated") {
    return { status: "signed-out", userId: null, usingCachedIdentity: false };
  }
  if (fallbackUserId) {
    return { status: "ready", userId: fallbackUserId, usingCachedIdentity: true };
  }
  if (fallbackUserId === null) {
    return { status: "signed-out", userId: null, usingCachedIdentity: false };
  }
  return { status: "loading", userId: null, usingCachedIdentity: false };
}
