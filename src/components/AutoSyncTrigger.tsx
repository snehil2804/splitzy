"use client";

import { useAutoSync } from "@/hooks/useAutoSync";
import { useSession } from "@/hooks/useSession";

/**
 * Mounts the automatic offline-queue sync triggers for the online app,
 * supplying the live session's user. Renders nothing.
 *
 * The Offline Mode screens call `useAutoSync` directly with their locally
 * resolved user id instead, so they never load the auth SDK.
 */
export function AutoSyncTrigger() {
  const { session } = useSession();
  useAutoSync(session?.user.id ?? null);
  return null;
}
