"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PencilIcon, PlusIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { EmptyState } from "@/components/StateViews";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSession } from "@/hooks/useSession";
import { formatFullDateTime, formatINR } from "@/lib/format";
import { getLatestReferenceDataForUser } from "@/lib/offlineDb";
import { syncPendingExpenses } from "@/lib/offlineSync";
import type { OfflineExpense, OfflineReferenceData } from "@/lib/offlineTypes";

const STATUS_LABEL: Record<OfflineExpense["sync_status"], string> = {
  pending: "Pending sync",
  syncing: "Syncing…",
  failed: "Needs attention",
  synced: "Synced",
};

/**
 * The dedicated, simplified Offline Mode — the only screen a signed-in user
 * with no connectivity should ever see (see `OfflineRedirector`). Reads
 * everything from IndexedDB (`offlineDb.ts`); never fetches live data.
 */
export default function OfflinePage() {
  const { status: sessionStatus, session } = useSession();
  const online = useOnlineStatus();
  const userId = session?.user.id ?? null;
  const { status: queueStatus, expenses, pendingCount, failedCount, removeExpense } = useOfflineQueue(userId);

  // `undefined` = still checking IndexedDB; `null` = checked, nothing cached.
  const [reference, setReference] = useState<OfflineReferenceData | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<OfflineExpense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [manualSyncResult, setManualSyncResult] = useState<{ synced: number; failed: number } | null>(
    null,
  );

  const isSyncingNow = expenses.some((e) => e.sync_status === "syncing");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getLatestReferenceDataForUser(userId).then((data) => {
      if (!cancelled) setReference(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeExpense(pendingDelete.local_id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSyncNow() {
    if (!userId) return;
    setManualSyncing(true);
    setManualSyncResult(null);
    try {
      const result = await syncPendingExpenses(userId, { manual: true });
      setManualSyncResult({ synced: result.syncedCount, failed: result.failedCount });
    } finally {
      setManualSyncing(false);
    }
  }

  if (sessionStatus === "loading" || (userId && reference === undefined)) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="glass anim-fade-up rounded-3xl p-5 text-center text-sm text-ink-muted">
          Loading…
        </div>
      </div>
    );
  }

  if (sessionStatus === "unauthenticated" || !userId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          emoji="🔒"
          title="Sign in required"
          message="Open Splitzy once while connected and sign in to prepare Offline Mode."
        />
      </div>
    );
  }

  if (!reference) {
    return (
      <div className="space-y-6">
        <Header online={online} />
        <EmptyState
          emoji="🔌"
          title="Offline Mode isn't ready yet"
          message="Open Splitzy once while connected to prepare Offline Mode."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header online={online} isSyncingNow={isSyncingNow} pendingCount={pendingCount} failedCount={failedCount} />

      <section className="anim-fade-up glass rounded-3xl p-5 text-center">
        <p className="text-sm leading-relaxed text-ink-muted">
          {online
            ? "You're back online. Expenses saved here will sync automatically."
            : "You're offline. Expenses saved here will sync when your connection returns."}
        </p>
        <Link
          href="/offline/add"
          className="tap mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-brand to-accent text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl"
        >
          <PlusIcon className="size-4" strokeWidth={2.4} />
          Add offline expense
        </Link>
      </section>

      <section className="anim-fade-up glass rounded-3xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-muted">Pending sync: {pendingCount}</h2>
          {online && pendingCount > 0 && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={manualSyncing || isSyncingNow}
              className="tap flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/20 disabled:opacity-60"
            >
              <RefreshIcon className={`size-3.5 ${manualSyncing || isSyncingNow ? "animate-spin" : ""}`} />
              {manualSyncing || isSyncingNow ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>

        {manualSyncResult && (
          <p className="anim-fade-in mt-2 text-xs font-medium text-ink-muted">
            {manualSyncResult.failed === 0
              ? manualSyncResult.synced > 0
                ? "All offline expenses synced"
                : "Nothing to sync"
              : `${manualSyncResult.synced} synced, ${manualSyncResult.failed} needs attention`}
          </p>
        )}

        {queueStatus === "loading" && <p className="mt-3 text-sm text-ink-muted">Loading…</p>}

        {queueStatus === "ready" && expenses.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted">Nothing queued yet.</p>
        )}

        {queueStatus === "ready" && expenses.length > 0 && (
          <ul className="mt-3 space-y-2.5">
            {expenses.map((e) => (
              <li
                key={e.local_id}
                className="flex items-center gap-3 rounded-2xl bg-line/60 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.description}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {STATUS_LABEL[e.sync_status]} ·{" "}
                    {formatFullDateTime(new Date(e.created_offline_at))}
                  </p>
                  {e.sync_status === "failed" && e.last_sync_error && (
                    <p className="mt-1 text-xs text-negative">{e.last_sync_error}</p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatINR(e.amount)}
                </span>
                {e.sync_status !== "syncing" && e.sync_status !== "synced" && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/offline/add?edit=${e.local_id}`}
                      aria-label={`Edit ${e.description}`}
                      className="tap -m-1 rounded-full p-1.5 text-ink-faint transition-colors hover:text-brand"
                    >
                      <PencilIcon className="size-4" />
                    </Link>
                    <button
                      onClick={() => setPendingDelete(e)}
                      aria-label={`Delete ${e.description}`}
                      className="tap -m-1 rounded-full p-1.5 text-ink-faint transition-colors hover:text-negative"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-ink-faint">
        Trip and member information last updated on{" "}
        {formatFullDateTime(new Date(reference.cached_at))}.
      </p>

      <ConfirmSheet
        open={pendingDelete !== null}
        title="Delete this offline expense?"
        message={
          pendingDelete
            ? `"${pendingDelete.description}" (${formatINR(pendingDelete.amount)}) will be removed from this device. It was never synced.`
            : ""
        }
        confirmLabel="Yes, delete it"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </div>
  );
}

function Header({
  online,
  isSyncingNow,
  pendingCount,
  failedCount,
}: {
  online?: boolean;
  isSyncingNow?: boolean;
  pendingCount?: number;
  failedCount?: number;
}) {
  const statusText = (() => {
    if (online === undefined) return null;
    if (!online) {
      return pendingCount ? `Offline · ${pendingCount} pending` : "Offline";
    }
    if (isSyncingNow) {
      return `Back online — syncing ${pendingCount ?? 0} ${pendingCount === 1 ? "expense" : "expenses"}`;
    }
    if (failedCount) {
      return `${failedCount} ${failedCount === 1 ? "expense needs" : "expenses need"} attention`;
    }
    if (pendingCount === 0) return "All offline expenses synced";
    return null;
  })();

  return (
    <header className="anim-fade-up pt-2">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Offline Mode</h1>
      {statusText && (
        <p
          className={`mt-1 text-sm font-medium ${
            !online ? "text-ink-muted" : failedCount ? "text-negative" : "text-positive"
          }`}
        >
          {statusText}
        </p>
      )}
    </header>
  );
}
