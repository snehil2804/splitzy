import { STORAGE_KEYS } from "./constants";
import type { LocationInput } from "./types";

/**
 * Recently-picked locations, device-local (localStorage), for one-tap
 * reselection of places this device visits often — also cuts Places API
 * calls for the common case of picking the same café/hotel again.
 */

const MAX_RECENTS = 5;

export function getRecentLocations(): LocationInput[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.recentLocations);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocationInput[]) : [];
  } catch {
    return [];
  }
}

export function addRecentLocation(location: LocationInput): void {
  if (typeof window === "undefined" || !location.placeId) return;
  const existing = getRecentLocations().filter((l) => l.placeId !== location.placeId);
  const next = [location, ...existing].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(STORAGE_KEYS.recentLocations, JSON.stringify(next));
  } catch {
    // Storage full or unavailable (private browsing) — recents are a nicety, not critical.
  }
}
