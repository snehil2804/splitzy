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

let invitationsChecked = false;

/**
 * Once per app load, accept any pending invitations addressed to this email
 * (claims the targeted guest member and joins its trips), then refresh trip
 * data if anything was accepted. Import is dynamic to avoid a module cycle
 * (queries → supabase ← useSession).
 */
async function checkInvitations() {
  if (invitationsChecked) return;
  invitationsChecked = true;
  try {
    const { acceptMyInvitations } = await import("@/lib/queries");
    await acceptMyInvitations();
  } catch {
    // Non-fatal: the user just won't see the invited trip until next load.
  }
}

function init() {
  if (initialized || !isSupabaseConfigured) return;
  initialized = true;

  const supabase = getSupabase();
  supabase.auth.getSession().then(({ data }) => {
    setState({
      status: data.session ? "authenticated" : "unauthenticated",
      session: data.session,
    });
    if (data.session) void checkInvitations();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    setState({ status: session ? "authenticated" : "unauthenticated", session });
    if (session) void checkInvitations();
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
