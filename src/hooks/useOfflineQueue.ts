"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { deleteOfflineExpense, listOfflineExpensesForUser } from "@/lib/offlineDb";
import type { OfflineExpense } from "@/lib/offlineTypes";

/**
 * Shared, reactive view of the current user's offline queue — same
 * SWR-style shared-store shape as `useTripData`, so every consumer (the
 * queue list, a future status indicator) reads one cache and stays in sync.
 * Always scoped to a `userId`; never exposes another account's records.
 */

interface QueueState {
  status: "idle" | "loading" | "ready";
  userId: string | null;
  expenses: OfflineExpense[];
}

let state: QueueState = { status: "idle", userId: null, expenses: [] };
const listeners = new Set<() => void>();

function setState(next: Partial<QueueState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => state;
const getServerSnapshot = (): QueueState => ({ status: "idle", userId: null, expenses: [] });

/** Re-reads the queue from IndexedDB and notifies every subscriber — call after any mutation. */
export async function refreshOfflineQueue(userId: string): Promise<void> {
  setState({ status: "loading", userId });
  const expenses = await listOfflineExpensesForUser(userId);
  // A user switch may have happened while this read was in flight — never
  // let a stale response for the previous user overwrite the current view.
  if (state.userId !== userId) return;
  setState({ status: "ready", expenses });
}

export function useOfflineQueue(userId: string | null) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!userId) return;
    if (state.userId === userId && state.status !== "idle") return;
    refreshOfflineQueue(userId);
  }, [userId]);

  const removeExpense = useCallback(
    async (localId: string) => {
      await deleteOfflineExpense(localId);
      if (userId) await refreshOfflineQueue(userId);
    },
    [userId],
  );

  const forThisUser = snapshot.userId === userId;
  const expenses = forThisUser ? snapshot.expenses : [];

  return {
    status: userId ? (forThisUser ? snapshot.status : "loading") : "idle",
    expenses,
    pendingCount: expenses.filter((e) => e.sync_status !== "synced").length,
    failedCount: expenses.filter((e) => e.sync_status === "failed").length,
    removeExpense,
  } as const;
}
