"use client";

import { useEffect, useState } from "react";
import { loadIdentityAndReference } from "@/lib/offlineDb";
import type { OfflineReferenceData } from "@/lib/offlineTypes";
import { useSession } from "./useSession";

/**
 * Everything the Offline Mode screens need to render, resolved in one shot:
 * who is signed in, and the cached trip/member reference data for them.
 *
 * Two problems this solves together:
 *
 * 1. `useSession()`'s initial `getSession()` can hang indefinitely offline —
 *    if the cached access token has expired the Supabase SDK attempts a
 *    network refresh first, which never settles with the radios off. Gating
 *    the page on it left users stuck on "Loading…" forever. So: if the
 *    device already reports itself offline there is nothing to wait for and
 *    we fall back immediately; otherwise we give the live session a short
 *    grace period before falling back. A resolved session always wins.
 *
 * 2. Identity and reference data used to be two sequential IndexedDB scans
 *    of the same store, so the screen couldn't paint until both finished.
 *    `loadIdentityAndReference()` now does it in one.
 *
 * The cached-identity fallback is only ever used while the session is
 * genuinely *indeterminate*. A session that has positively resolved to
 * signed-out short-circuits to "signed-out" without reading anything — a
 * signed-out visitor must never be shown the last account's queue.
 */

const FALLBACK_TIMEOUT_MS = 2500;

type OfflineBootstrapStatus = "loading" | "ready" | "signed-out";

interface OfflineBootstrapResult {
  status: OfflineBootstrapStatus;
  userId: string | null;
  reference: OfflineReferenceData | null;
  /** True when `userId` came from the local cache, not a confirmed live session. */
  usingCachedIdentity: boolean;
}

export function useOfflineBootstrap(): OfflineBootstrapResult {
  const { status: sessionStatus, session } = useSession();
  const sessionUserId = session?.user.id ?? null;
  const [loaded, setLoaded] = useState<{
    userId: string | null;
    reference: OfflineReferenceData | null;
    fromCachedIdentity: boolean;
  } | null>(null);

  useEffect(() => {
    // Positively signed out: nothing to read, and nothing we're allowed to
    // fall back to. Handled in the derivation below.
    if (sessionStatus === "unauthenticated") return;

    let cancelled = false;
    const read = (useCachedIdentity: boolean) => {
      loadIdentityAndReference(useCachedIdentity ? null : sessionUserId).then((result) => {
        if (!cancelled) setLoaded({ ...result, fromCachedIdentity: useCachedIdentity });
      });
    };

    if (sessionStatus === "authenticated") {
      read(false);
      return () => {
        cancelled = true;
      };
    }

    // Session still resolving. Offline means its network refresh cannot
    // possibly succeed, so skip the wait entirely.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      read(true);
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => read(true), FALLBACK_TIMEOUT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionStatus, sessionUserId]);

  if (sessionStatus === "unauthenticated") {
    return { status: "signed-out", userId: null, reference: null, usingCachedIdentity: false };
  }
  if (!loaded) {
    return { status: "loading", userId: null, reference: null, usingCachedIdentity: false };
  }
  if (!loaded.userId) {
    return { status: "signed-out", userId: null, reference: null, usingCachedIdentity: false };
  }
  return {
    status: "ready",
    userId: loaded.userId,
    reference: loaded.reference,
    usingCachedIdentity: loaded.fromCachedIdentity,
  };
}
