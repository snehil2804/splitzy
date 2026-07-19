"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { isPermissionError } from "@/lib/errors";
import { fetchTripData, softDeleteExpense } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { TripData } from "@/lib/types";
import { getSelectedTripId, useSelectedTripId } from "./useSelectedTrip";

/**
 * Minimal shared data store (SWR-style) so every page reads the same cache:
 * tab switches render instantly from cache while a background refresh runs.
 * Keyed by the selected trip — switching trips forces a fresh load.
 */

export type TripDataStatus =
  | "loading"
  | "ready"
  | "error"
  /** RLS/grant denial: signed in, but not a member of any visible trip. */
  | "forbidden"
  | "unconfigured";

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
let fetchedForTripId: string | null = null;
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
  const selectedTripId = getSelectedTripId();
  const sameTrip = fetchedForTripId === selectedTripId;
  const fresh = Date.now() - fetchedAt < STALE_AFTER_MS;
  if (!force && sameTrip && fresh && state.data) return;

  inflight = (async () => {
    // Keep showing cached data during same-trip background refreshes, but
    // show the loading state when switching to a different trip.
    if (!state.data || !sameTrip) setState({ status: "loading", error: null });
    try {
      const data = await fetchTripData(selectedTripId);
      fetchedAt = Date.now();
      fetchedForTripId = selectedTripId;
      setState({ status: "ready", data, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      const status: TripDataStatus = isPermissionError(message) ? "forbidden" : "error";
      setState(
        state.data && sameTrip ? { error: message } : { status, error: message },
      );
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useTripData() {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const selectedTripId = useSelectedTripId();

  useEffect(() => {
    void load();
  }, [selectedTripId]);

  const refresh = useCallback(() => load(true), []);

  /**
   * Optimistically removes the expense, then persists the soft delete.
   * `deletedById` = the signed-in user's member id (audit column), or null.
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
