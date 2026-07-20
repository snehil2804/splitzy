"use client";

import { useEffect, useSyncExternalStore } from "react";
import { setActiveUserId } from "@/lib/offlineDb";
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

/**
 * NOTE: this used to also fire `accept_my_invitations()` (email-matched
 * auto-claim) on every login. Removed — it raced with `/join/[token]`'s
 * explicit `claim_invitation()` whenever an invite carried an email
 * matching the signer's own, since both targeted the same row on the same
 * sign-in event. The link flow (open invite → sign in → claim) is now the
 * single source of truth for claiming; the `invitations.email` column is
 * still stored (shown to the owner, kept for a future explicit "resend by
 * email" feature) but no longer drives any automatic claim.
 */
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
  // Offline Mode reads this marker instead of the session (so it never has
  // to load the auth SDK), so signing out has to clear it explicitly rather
  // than relying on a particular component being mounted to notice. Note
  // this clears only *who is signed in* — queued offline expenses are
  // deliberately left untouched, so unsynced work survives a sign-out.
  await setActiveUserId(null).catch((err) => {
    console.error("Failed to clear the active user for offline mode:", err);
  });
}
