"use client";

import { useSyncExternalStore } from "react";

/**
 * Mirrors `navigator.onLine` reactively. This is a signal for UI/routing
 * decisions (which mode to show, when to attempt a sync) — it is not itself
 * an authorization boundary; every write still goes through the server's own
 * checks regardless of what the client believes about its connectivity.
 */

function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

const getSnapshot = () => navigator.onLine;
// Prerendered HTML always assumes online — resolved for real in the effect
// that follows hydration, same hydration-safety pattern used by useTheme.
const getServerSnapshot = () => true;

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
