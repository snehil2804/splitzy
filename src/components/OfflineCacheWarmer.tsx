"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { PAYMENT_SUGGESTIONS } from "@/lib/constants";
import { saveReferenceData } from "@/lib/offlineDb";

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
  const { session } = useSession();
  const { status, data } = useTripData();
  const lastSignature = useRef<string | null>(null);

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

    // Best-effort cache warm — lets the service worker capture the offline
    // shell's HTML + JS chunks now, before they're ever needed offline.
    if ("serviceWorker" in navigator) {
      fetch("/offline").catch(() => {});
      fetch("/offline/add").catch(() => {});
    }
  }, [session, status, data]);

  return null;
}
