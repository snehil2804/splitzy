"use client";

import { useCallback, useEffect, useState } from "react";
import { isPlacesConfigured, resolveCurrentPlace, type PlaceResult } from "@/lib/places";

/**
 * Automatic GPS → named-place detection for the Add Expense screen.
 * Calling `navigator.geolocation.getCurrentPosition()` itself triggers the
 * browser's native permission prompt the first time (nothing extra needed
 * to "ask"); if permission was already granted or denied in a past visit,
 * the browser resolves/rejects immediately with no prompt at all — exactly
 * the "don't ask again" behavior this is meant to have.
 */

export type LocationDetectionStatus =
  | "idle"
  | "locating"
  | "done"
  | "denied"
  | "unavailable"
  | "unsupported";

interface UseCurrentLocationResult {
  status: LocationDetectionStatus;
  place: PlaceResult | null;
  /** Re-run detection (e.g. after the user grants permission via browser settings and taps "try again"). */
  retry: () => void;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 60_000,
};

/** Transient GPS failures (timeout / position unavailable) get one automatic retry before giving up. */
const MAX_AUTO_RETRIES = 1;

interface DetectionResult {
  attempt: number;
  status: Exclude<LocationDetectionStatus, "idle" | "locating" | "unsupported">;
  place: PlaceResult | null;
}

/** Fully deterministic from the environment — never needs to be an effect/state. */
function isUnsupported(): boolean {
  return typeof navigator === "undefined" || !navigator.geolocation || !isPlacesConfigured;
}

export function useCurrentLocation(enabled: boolean): UseCurrentLocationResult {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<DetectionResult | null>(null);

  useEffect(() => {
    if (!enabled || isUnsupported()) return;

    let cancelled = false;
    let autoRetries = 0;

    function attemptDetect() {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (cancelled) return;
          try {
            const resolved = await resolveCurrentPlace(
              position.coords.latitude,
              position.coords.longitude,
            );
            if (!cancelled) setResult({ attempt, status: "done", place: resolved });
          } catch {
            if (!cancelled) setResult({ attempt, status: "unavailable", place: null });
          }
        },
        (error) => {
          if (cancelled) return;
          if (error.code === error.PERMISSION_DENIED) {
            setResult({ attempt, status: "denied", place: null });
            return;
          }
          if (autoRetries < MAX_AUTO_RETRIES) {
            autoRetries += 1;
            setTimeout(() => {
              if (!cancelled) attemptDetect();
            }, 1500);
          } else {
            setResult({ attempt, status: "unavailable", place: null });
          }
        },
        GEO_OPTIONS,
      );
    }
    attemptDetect();

    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  // No result recorded yet for the current attempt = still in flight —
  // derived, not a separately-tracked "loading" flag.
  const current = result?.attempt === attempt ? result : null;
  const status: LocationDetectionStatus = !enabled
    ? "idle"
    : isUnsupported()
      ? "unsupported"
      : (current?.status ?? "locating");
  const place = current?.place ?? null;

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { status, place, retry };
}
