"use client";

import { useEffect, useState } from "react";

type GpsStatus = "idle" | "locating" | "done" | "unavailable";

interface GpsResult {
  status: "done" | "unavailable";
  coords: { latitude: number; longitude: number } | null;
}

/**
 * Raw device coordinates only — no reverse geocoding, no network request of
 * any kind. Smart Location's named-place resolution goes through Google
 * Places, which is explicitly off-limits while offline; this hook never
 * touches it. A failure or a denied prompt just means no coordinates get
 * attached — it never blocks saving the expense.
 */
export function useOfflineGps(enabled: boolean) {
  const [result, setResult] = useState<GpsResult | null>(null);
  // A plain capability check, not state — nothing to synchronize with an
  // external system here, so it needs no effect of its own.
  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;

  useEffect(() => {
    if (!enabled || !supported) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        setResult({
          status: "done",
          coords: { latitude: position.coords.latitude, longitude: position.coords.longitude },
        });
      },
      () => {
        if (cancelled) return;
        setResult({ status: "unavailable", coords: null });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, supported]);

  const status: GpsStatus = !enabled ? "idle" : !supported ? "unavailable" : (result?.status ?? "locating");

  return { status, coords: result?.coords ?? null };
}
