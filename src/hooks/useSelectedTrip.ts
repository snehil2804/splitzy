"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/lib/constants";

/**
 * Which trip this device is currently viewing, persisted per device.
 * `null` means "no explicit choice" — `fetchTripData` then falls back to
 * the active trip, then the newest.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): string | null {
  return localStorage.getItem(STORAGE_KEYS.tripId);
}

const getServerSnapshot = () => null;

export function getSelectedTripId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEYS.tripId);
}

export function setSelectedTripId(tripId: string | null) {
  if (tripId) localStorage.setItem(STORAGE_KEYS.tripId, tripId);
  else localStorage.removeItem(STORAGE_KEYS.tripId);
  listeners.forEach((listener) => listener());
}

export function useSelectedTripId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
