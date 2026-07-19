"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { fetchTripData, softDeleteExpense } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { TripData } from "@/lib/types";

/**
 * Minimal shared data store (SWR-style) so every page reads the same cache:
 * tab switches render instantly from cache while a background refresh runs.
 */

export type TripDataStatus = "loading" | "ready" | "error" | "unconfigured";

interface StoreState {
  status: TripDataStatus;
  data: TripData | null;
  error: string | null;
}

const STALE_AFTER_MS = 30_000;

let state: StoreState = {
  status: isSupabaseConfigured ? "loading" : "unconfigured",
  data: null,
  error: null,
};
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<StoreState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const serverSnapshot: StoreState = { status: "loading", data: null, error: null };
const getServerSnapshot = () => serverSnapshot;

async function load(force = false): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (inflight) return inflight;
  const fresh = Date.now() - fetchedAt < STALE_AFTER_MS;
  if (!force && fresh && state.data) return;

  inflight = (async () => {
    // Keep showing cached data during background refreshes.
    if (!state.data) setState({ status: "loading", error: null });
    try {
      const data = await fetchTripData();
      fetchedAt = Date.now();
      setState({ status: "ready", data, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setState(state.data ? { error: message } : { status: "error", error: message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useTripData() {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void load();
  }, []);

  const refresh = useCallback(() => load(true), []);

  /**
   * Optimistically removes the expense, then persists the soft delete.
   * `deletedById` = the member using this device (audit column), or null.
   */
  const deleteExpense = useCallback(
    async (expenseId: string, deletedById: string | null) => {
      const previous = state.data;
      if (!previous) return;
      setState({
        data: {
          ...previous,
          expenses: previous.expenses.filter((e) => e.id !== expenseId),
        },
      });
      try {
        await softDeleteExpense(expenseId, deletedById);
        void load(true);
      } catch (err) {
        setState({ data: previous });
        throw err;
      }
    },
    [],
  );

  return { ...store, refresh, deleteExpense };
}
