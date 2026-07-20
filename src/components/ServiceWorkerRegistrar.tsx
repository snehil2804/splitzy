"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` once per app load. Renders nothing — purely a
 * mount-time side effect, same shape as the inline theme script but as a
 * real effect since `navigator.serviceWorker` isn't available at SSR time.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
