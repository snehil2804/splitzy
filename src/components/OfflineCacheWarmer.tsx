"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { PAYMENT_SUGGESTIONS } from "@/lib/constants";
import { saveReferenceData, setActiveUserId } from "@/lib/offlineDb";
import { syncPendingExpenses } from "@/lib/offlineSync";

/**
 * Whenever the app successfully loads real trip data online, refreshes the
 * offline reference-data cache (trip name, active members, payment method
 * list — exactly what the offline form needs, nothing else) and warms the
 * service worker's cache for the offline-shell routes. Together, these are
 * what make Offline Mode usable with zero network on the next launch.
 * Renders nothing — a pure background side effect, same shape as
 * `ServiceWorkerRegistrar`.
 */
export function OfflineCacheWarmer() {
  const { status: sessionStatus, session } = useSession();
  const { status, data } = useTripData();
  const lastSignature = useRef<string | null>(null);

  // Record who's signed in so the offline screens can answer that question
  // from IndexedDB alone, without loading the Supabase SDK. Kept separate
  // from the reference-data effect below because it must not wait on trip
  // data — the answer is known as soon as the session resolves.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    setActiveUserId(session?.user.id ?? null).catch((err) => {
      console.error("Failed to record the active user for offline mode:", err);
    });
  }, [sessionStatus, session]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || status !== "ready" || !data?.trip) return;

    const signature = `${userId}:${data.trip.id}:${data.members.map((m) => m.id).join(",")}`;
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;

    const myMember = data.members.find((m) => m.id === data.myMemberId);

    saveReferenceData({
      trip_id: data.trip.id,
      trip_name: data.trip.name,
      user_id: userId,
      user_display_name: myMember?.name ?? session.user.email ?? "You",
      members: data.members.map((m) => ({ id: m.id, name: m.name })),
      default_currency: "INR",
      payment_methods: PAYMENT_SUGGESTIONS,
      cached_at: new Date().toISOString(),
    }).catch((err) => {
      console.error("Failed to cache offline reference data:", err);
    });

    // Ask the service worker to (re)precache the offline shell now that
    // we're demonstrably online and authenticated. This must go through the
    // worker rather than a plain `fetch()` here: fetching the routes from
    // the page only ever caches those two HTML documents, not the JS chunks
    // they need to actually render — without which Offline Mode loads and
    // then sits on "Loading…" forever. `precacheShell()` in the worker
    // scrapes and stores those chunks too.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.active?.postMessage({ type: "precache-shell" });
        })
        .catch(() => {});
    }

    // Reference data just refreshed, which means we're genuinely online —
    // a good moment to also flush anything still queued.
    syncPendingExpenses(userId).catch(() => {});
  }, [session, status, data]);

  return null;
}
