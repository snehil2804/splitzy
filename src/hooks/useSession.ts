"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

/**
 * Client-side mirror of the auth session, kept in sync via Supabase's
 * `onAuthStateChange` listener. `proxy.ts` is the actual access-control
 * boundary (it runs before this ever renders) — this hook exists for UI
 * concerns: showing the signed-in email, disabling the login form while a
 * session is still resolving, driving the Settings sign-out button.
 */

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  session: Session | null;
}

let state: SessionState = { status: "loading", session: null };
let initialized = false;
const listeners = new Set<() => void>();

function setState(next: SessionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = (): SessionState => ({ status: "loading", session: null });

function init() {
  if (initialized || !isSupabaseConfigured) return;
  initialized = true;

  const supabase = getSupabase();
  supabase.auth.getSession().then(({ data }) => {
    setState({
      status: data.session ? "authenticated" : "unauthenticated",
      session: data.session,
    });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    setState({ status: session ? "authenticated" : "unauthenticated", session });
  });
}

export function useSession() {
  useEffect(() => {
    init();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}
