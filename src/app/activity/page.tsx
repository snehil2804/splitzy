"use client";

import { ListSkeleton } from "@/components/Skeleton";
import { AccessDeniedState, EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
import { useTripData } from "@/hooks/useTripData";
import { useEffect, useState } from "react";
import { formatDate, formatTime } from "@/lib/format";
import { fetchActivity } from "@/lib/queries";
import type { ActivityEntry } from "@/lib/types";

/**
 * Read-only, immutable feed of everything that happened on this trip —
 * populated by database triggers (see `activity_log` in the Stage 3
 * migration), never editable from here.
 */
export default function ActivityPage() {
  const { status, data, error, refresh } = useTripData();
  const tripId = data?.trip?.id ?? null;

  // Keyed by trip id (like `fetchedInvitations` on the Trips page) so a trip
  // switch shows loading state via the id mismatch below, with no
  // synchronous setState-in-effect resets needed.
  const [fetched, setFetched] = useState<{ tripId: string; list: ActivityEntry[] } | null>(
    null,
  );
  const [loadError, setLoadError] = useState<{ tripId: string; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    fetchActivity(tripId)
      .then((list) => {
        if (!cancelled) setFetched({ tripId, list });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError({
            tripId,
            message: err instanceof Error ? err.message : "Couldn't load activity.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const entries = fetched?.tripId === tripId ? fetched.list : null;
  const currentLoadError = loadError?.tripId === tripId ? loadError.message : null;

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Activity</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Everything that&apos;s happened on this trip.
        </p>
      </header>

      {status === "unconfigured" && <SetupNotice />}
      {status === "loading" && <ListSkeleton count={6} />}
      {status === "error" && <ErrorState message={error ?? ""} onRetry={refresh} />}
      {status === "forbidden" && <AccessDeniedState onRetry={refresh} />}

      {status === "ready" && !data?.trip && (
        <EmptyState
          emoji="🧳"
          title="No active trip"
          message="Create or select a trip to see its activity here."
        />
      )}

      {status === "ready" && data?.trip && (
        <>
          {currentLoadError && <ErrorState message={currentLoadError} onRetry={refresh} />}
          {!currentLoadError && entries === null && <ListSkeleton count={6} />}
          {!currentLoadError && entries !== null && entries.length === 0 && (
            <EmptyState
              emoji="📜"
              title="Nothing yet"
              message="Expenses, member changes, and settlements will show up here as they happen."
            />
          )}
          {!currentLoadError && entries !== null && entries.length > 0 && (
            <ul className="space-y-2.5">
              {entries.map((entry, i) => (
                <li
                  key={entry.id}
                  className="anim-fade-up glass flex items-start gap-3 rounded-2xl p-4"
                  style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                >
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{entry.description}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
