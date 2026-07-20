"use client";

import { AutoSyncTrigger } from "./AutoSyncTrigger";
import { OfflineCacheWarmer } from "./OfflineCacheWarmer";
import { Sidebar } from "./Sidebar";

/**
 * Every part of the app shell that depends on the Supabase SDK, gathered
 * into one module so it can be code-split away from the Offline Mode
 * routes (see `ShellGate`). Nothing here is useful without a network:
 * `Sidebar` shows live trip/member data, `OfflineCacheWarmer` caches it,
 * and `AutoSyncTrigger` uploads the queue.
 *
 * Keeping these in the root layout unconditionally is what put ~256 kB of
 * auth SDK on Offline Mode's critical path.
 */
export default function OnlineShell() {
  return (
    <>
      <Sidebar />
      <OfflineCacheWarmer />
      <AutoSyncTrigger />
    </>
  );
}
