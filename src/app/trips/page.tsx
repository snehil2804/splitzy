"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { CardSkeleton } from "@/components/Skeleton";
import { ErrorState, SetupNotice } from "@/components/StateViews";
import { setSelectedTripId } from "@/hooks/useSelectedTrip";
import { useTripData } from "@/hooks/useTripData";
import {
  addGuestMember,
  createTrip,
  fetchInvitations,
  inviteMember,
  renameTrip,
  revokeInvitation,
  setMemberActive,
} from "@/lib/queries";
import type { Invitation } from "@/lib/types";

/**
 * Trip management: switch between your trips, create new ones, and (as
 * owner) rename the trip, add guest members, and invite people by email.
 */
export default function TripsPage() {
  const router = useRouter();
  const { status, data, error, refresh } = useTripData();

  const [newTripName, setNewTripName] = useState("");
  const [creating, setCreating] = useState(false);
  // Rename drafts and fetched invitations are keyed by trip id, so switching
  // trips resets both during render — no state-syncing effects needed.
  const [renameDraft, setRenameDraft] = useState<{
    tripId: string;
    value: string;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMemberId, setInviteMemberId] = useState<string | "">("");
  const [busy, setBusy] = useState(false);
  const [fetchedInvitations, setFetchedInvitations] = useState<{
    tripId: string;
    list: Invitation[];
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isOwner = data?.myRole === "owner";
  const tripId = data?.trip?.id ?? null;

  const renameValue =
    renameDraft?.tripId === tripId ? renameDraft.value : (data?.trip?.name ?? "");
  const invitations =
    fetchedInvitations?.tripId === tripId ? fetchedInvitations.list : [];

  useEffect(() => {
    if (!tripId || !isOwner) return;
    let cancelled = false;
    fetchInvitations(tripId)
      .then((list) => {
        if (!cancelled) setFetchedInvitations({ tripId, list });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tripId, isOwner]);

  function note(message: string) {
    setFormError(null);
    setFeedback(message);
  }
  function fail(err: unknown) {
    setFeedback(null);
    setFormError(err instanceof Error ? err.message : "Something went wrong.");
  }

  async function handleCreateTrip(e: FormEvent) {
    e.preventDefault();
    if (!newTripName.trim()) return;
    setCreating(true);
    try {
      const id = await createTrip(newTripName.trim());
      setNewTripName("");
      setSelectedTripId(id);
      await refresh();
      note("Trip created.");
      router.push("/");
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (!tripId || !renameValue.trim()) return;
    setRenaming(true);
    try {
      await renameTrip(tripId, renameValue.trim());
      await refresh();
      note("Trip renamed.");
    } catch (err) {
      fail(err);
    } finally {
      setRenaming(false);
    }
  }

  async function handleAddGuest(e: FormEvent) {
    e.preventDefault();
    if (!tripId || !guestName.trim()) return;
    setBusy(true);
    try {
      await addGuestMember(tripId, guestName.trim());
      setGuestName("");
      await refresh();
      note("Member added.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!tripId || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      await inviteMember(tripId, inviteEmail.trim(), inviteMemberId || null);
      setInviteEmail("");
      setInviteMemberId("");
      setFetchedInvitations({ tripId, list: await fetchInvitations(tripId) });
      note("Invitation created. They'll join automatically after signing in with that email.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    if (!tripId) return;
    setBusy(true);
    try {
      await revokeInvitation(invitationId);
      setFetchedInvitations({ tripId, list: await fetchInvitations(tripId) });
      note("Invitation revoked.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!tripId) return;
    setBusy(true);
    try {
      await setMemberActive(tripId, memberId, false);
      await refresh();
      note("Member removed from this trip. Their past expenses stay.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (status === "unconfigured") {
    return (
      <div className="space-y-6">
        <Header />
        <SetupNotice />
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div className="space-y-6">
        <Header />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={2} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="space-y-6">
        <Header />
        <ErrorState message={error ?? ""} onRetry={refresh} />
      </div>
    );
  }
  if (status === "forbidden") {
    // RLS denies reads until you're on a trip — but creating one doesn't
    // depend on reading trip data, so this stays usable rather than
    // routing a not-yet-a-member user through AccessDeniedState's
    // "Go to trips" link, which would just land back here.
    return (
      <div className="space-y-6">
        <Header />
        <section className="anim-fade-up glass rounded-3xl p-5">
          <h2 className="text-sm font-semibold">Start your first trip</h2>
          <p className="mt-1 text-sm text-ink-muted">
            You&apos;re not on any trip yet. Create one, or ask an existing
            trip&apos;s owner to invite you by email.
          </p>
          <form onSubmit={handleCreateTrip} className="mt-4 flex gap-2">
            <input
              type="text"
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              placeholder="New trip name"
              maxLength={80}
              className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
            <button
              type="submit"
              disabled={creating || !newTripName.trim()}
              aria-label="Create trip"
              className="tap grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/25 disabled:opacity-60"
            >
              <PlusIcon className="size-5" strokeWidth={2.4} />
            </button>
          </form>
          {formError && (
            <p className="anim-fade-in mt-3 rounded-2xl bg-negative/10 p-3 text-center text-sm font-medium text-negative">
              {formError}
            </p>
          )}
        </section>
      </div>
    );
  }
  if (!data) return null;

  const unclaimedMembers = data.members.filter((m) => !m.userId);

  return (
    <div className="space-y-6">
      <Header />

      {/* Your trips */}
      <section className="anim-fade-up glass rounded-3xl p-5">
        <h2 className="text-sm font-semibold">Your trips</h2>
        {data.trips.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No trips yet — create one below.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.trips.map((t) => {
              const selected = t.id === data.trip?.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      setSelectedTripId(t.id);
                      router.push("/");
                    }}
                    aria-pressed={selected}
                    className={`tap flex min-h-12 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${
                      selected
                        ? "border-brand bg-brand-soft"
                        : "border-transparent bg-line/60"
                    }`}
                  >
                    <span className="text-xl">🧳</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {t.name}
                      </span>
                      <span className="text-xs capitalize text-ink-muted">
                        {t.status}
                      </span>
                    </span>
                    {selected && (
                      <CheckIcon className="size-4 shrink-0 text-brand" strokeWidth={2.6} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={handleCreateTrip} className="mt-4 flex gap-2">
          <input
            type="text"
            value={newTripName}
            onChange={(e) => setNewTripName(e.target.value)}
            placeholder="New trip name"
            maxLength={80}
            className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
          />
          <button
            type="submit"
            disabled={creating || !newTripName.trim()}
            aria-label="Create trip"
            className="tap grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/25 disabled:opacity-60"
          >
            <PlusIcon className="size-5" strokeWidth={2.4} />
          </button>
        </form>
      </section>

      {data.trip && (
        <>
          {/* Members of the selected trip */}
          <section
            className="anim-fade-up glass rounded-3xl p-5"
            style={{ animationDelay: "60ms" }}
          >
            <h2 className="text-sm font-semibold">Members · {data.trip.name}</h2>
            <ul className="mt-3 space-y-2">
              {data.members.map((m) => (
                <li
                  key={m.id}
                  className="flex min-h-12 items-center gap-3 rounded-2xl bg-line/60 px-4 py-2.5"
                >
                  <Avatar name={m.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.name}
                      {m.id === data.myMemberId && (
                        <span className="text-ink-muted"> (you)</span>
                      )}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {m.role === "owner" ? "Owner" : "Member"}
                      {!m.userId && " · guest"}
                    </span>
                  </span>
                  {isOwner && m.id !== data.myMemberId && (
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      disabled={busy}
                      className="tap rounded-full px-3 py-1.5 text-xs font-semibold text-negative disabled:opacity-60"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {isOwner && (
              <form onSubmit={handleAddGuest} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Add a guest (no login needed)"
                  maxLength={60}
                  className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                />
                <button
                  type="submit"
                  disabled={busy || !guestName.trim()}
                  aria-label="Add guest member"
                  className="tap grid size-12 shrink-0 place-items-center rounded-2xl bg-line text-ink disabled:opacity-60"
                >
                  <PlusIcon className="size-5" strokeWidth={2.4} />
                </button>
              </form>
            )}
          </section>

          {/* Owner tools: rename + invitations */}
          {isOwner && (
            <section
              className="anim-fade-up glass space-y-5 rounded-3xl p-5"
              style={{ animationDelay: "120ms" }}
            >
              <div>
                <h2 className="text-sm font-semibold">Rename trip</h2>
                <form onSubmit={handleRename} className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) =>
                      setRenameDraft({ tripId: tripId!, value: e.target.value })
                    }
                    maxLength={80}
                    className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={renaming || !renameValue.trim() || renameValue.trim() === data.trip.name}
                    className="tap shrink-0 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
                  >
                    Save
                  </button>
                </form>
              </div>

              <div>
                <h2 className="text-sm font-semibold">Invite by email</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  They join this trip automatically when they sign in with that
                  email. Link the invite to a guest so they claim that identity
                  and its expense history.
                </p>
                <form onSubmit={handleInvite} className="mt-2 space-y-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="friend@example.com"
                    className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                  />
                  {unclaimedMembers.length > 0 && (
                    <select
                      value={inviteMemberId}
                      onChange={(e) => setInviteMemberId(e.target.value)}
                      className="min-h-12 w-full appearance-none rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                    >
                      <option value="">Don&apos;t link to a guest</option>
                      {unclaimedMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          This is {m.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    disabled={busy || !inviteEmail.trim()}
                    className="tap w-full min-h-12 rounded-2xl bg-brand py-3 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
                  >
                    Send invitation
                  </button>
                </form>

                {invitations.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {invitations.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex min-h-12 items-center gap-3 rounded-2xl bg-line/60 px-4 py-2.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{inv.email}</span>
                          <span className="text-xs text-ink-muted">Pending</span>
                        </span>
                        <button
                          onClick={() => handleRevoke(inv.id)}
                          disabled={busy}
                          className="tap rounded-full px-3 py-1.5 text-xs font-semibold text-negative disabled:opacity-60"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {feedback && (
        <p className="anim-fade-in rounded-2xl bg-positive/10 p-4 text-center text-sm font-medium text-positive">
          {feedback}
        </p>
      )}
      {formError && (
        <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
          {formError}
        </p>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up pt-2">
      <h1 className="text-2xl font-bold tracking-tight">Trips</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Switch trips, invite people, manage members.
      </p>
    </header>
  );
}
