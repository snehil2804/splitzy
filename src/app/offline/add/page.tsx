"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";

/**
 * Placeholder for the offline expense capture form — foundation checkpoint
 * only wires the route (so the service worker has something real to cache
 * and the shell's navigation works end-to-end). The actual form lands in
 * the next checkpoint, alongside the cached trip/member reference data it
 * needs to build its "who paid / participants" pickers.
 */
export default function OfflineAddExpensePage() {
  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <Link
          href="/offline"
          className="tap flex items-center gap-0.5 text-xs font-semibold text-brand transition-opacity hover:opacity-70"
        >
          <ChevronRightIcon className="size-3.5 rotate-180" />
          Back to Offline Mode
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Add offline expense</h1>
      </header>
      <div className="glass anim-fade-up rounded-3xl p-5 text-center text-sm text-ink-muted">
        Coming soon.
      </div>
    </div>
  );
}
