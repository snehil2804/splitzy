"use client";

import { useAutoSync } from "@/hooks/useAutoSync";

/** Mounts the automatic offline-queue sync triggers. Renders nothing. */
export function AutoSyncTrigger() {
  useAutoSync();
  return null;
}
