"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "@/lib/constants";

/**
 * Which of the three friends is using this device. Stored locally so the
 * app can personalise greetings and balance framing ("You owe…").
 * Returns `null` on the server and until chosen in Settings.
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
  return localStorage.getItem(STORAGE_KEYS.identity);
}

const getServerSnapshot = () => null;

export function setIdentity(name: string | null) {
  if (name) localStorage.setItem(STORAGE_KEYS.identity, name);
  else localStorage.removeItem(STORAGE_KEYS.identity);
  listeners.forEach((listener) => listener());
}

export function useIdentity(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
