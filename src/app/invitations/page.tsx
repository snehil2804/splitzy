"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { MailIcon } from "@/components/icons";
import { CardSkeleton } from "@/components/Skeleton";
import { EmptyState, SetupNotice } from "@/components/StateViews";
import { setSelectedTripId } from "@/hooks/useSelectedTrip";
import { claimInvitation, declineInvitation, fetchMyInvitations } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { MyInvitation } from "@/lib/types";

/**
 * Invitations addressed to the signed-in user's own email — the
 * existing-account counterpart to /join/[token]. Accept reuses
 * `claim_invitation()` unchanged; Decline is a new, narrowly-scoped RPC
 * that only ever touches this one invitation's status.
 */
export default function InvitationsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [invitations, setInvitations] = useState<MyInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    load();
  }, []);

  async function load() {
    setStatus("loading");
    try {
      setInvitations(await fetchMyInvitations());
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load invitations.");
      setStatus("error");
    }
  }

  async function handleAccept(inv: MyInvitation) {
    setBusyId(inv.id);
    setError(null);
    try {
      const tripId = await claimInvitation(inv.token);
      setSelectedTripId(tripId);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept that invite.");
      setBusyId(null);
      load();
    }
  }

  async function handleDecline(inv: MyInvitation) {
    setBusyId(inv.id);
    setError(null);
    try {
      await declineInvitation(inv.id);
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't decline that invite.");
    } finally {
      setBusyId(null);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6">
        <Header />
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      {status === "loading" && (
        <div className="space-y-3">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
      )}

      {status === "error" && (
        <p className="anim-fade-up rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
          {error}
        </p>
      )}

      {status === "ready" && invitations.length === 0 && (
        <EmptyState
          emoji="📬"
          title="No pending invitations"
          message="When someone invites you to a trip, it'll show up here."
        />
      )}

      {status === "ready" && invitations.length > 0 && (
        <ul className="space-y-3">
          {invitations.map((inv, i) => (
            <li
              key={inv.id}
              className="anim-fade-up glass rounded-3xl p-5"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start gap-3">
                <Avatar name={inv.memberName} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{inv.tripName}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    From {inv.inviterName} · join as{" "}
                    <span className="font-medium text-ink">{inv.memberName}</span>
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    Sent {formatDate(inv.createdAt)} · Expires {formatDate(inv.expiresAt)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleDecline(inv)}
                  disabled={busyId === inv.id}
                  className="tap min-h-11 rounded-2xl bg-line/60 text-sm font-semibold transition-colors hover:bg-line disabled:opacity-60"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleAccept(inv)}
                  disabled={busyId === inv.id}
                  className="tap min-h-11 rounded-2xl bg-gradient-to-br from-brand to-accent text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
                >
                  {busyId === inv.id ? "…" : "Accept"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {status === "ready" && error && (
        <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up pt-2">
      <div className="flex items-center gap-2">
        <MailIcon className="size-6 text-brand" strokeWidth={2} />
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Invitations</h1>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Trips people have invited you to join.
      </p>
    </header>
  );
}
