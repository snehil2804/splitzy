"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import {
  CheckIcon,
  ChevronRightIcon,
  LinkIcon,
  PlusIcon,
  ShareIcon,
  WhatsAppIcon,
} from "@/components/icons";
import { CardSkeleton } from "@/components/Skeleton";
import { ErrorState, SetupNotice } from "@/components/StateViews";
import { setSelectedTripId } from "@/hooks/useSelectedTrip";
import { useTripData } from "@/hooks/useTripData";
import {
  addGuestMember,
  createTrip,
  deleteTrip,
  fetchInvitations,
  inviteMember,
  leaveTrip,
  renameTrip,
  revokeInvitation,
  setMemberActive,
  setMemberRole,
  setTripStatus,
  transferTripOwnership,
  updateTripDescription,
} from "@/lib/queries";
import type { Invitation, Member } from "@/lib/types";

type GeneratedInvite = { link: string; memberName: string };

function buildInviteLink(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

function whatsappShareUrl(link: string, tripName: string): string {
  const text = `Join "${tripName}" on Splitzy to track our shared expenses: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

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
  const [descriptionDraft, setDescriptionDraft] = useState<{
    tripId: string;
    value: string;
  } | null>(null);
  const [savingDescription, setSavingDescription] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [pendingDeleteTrip, setPendingDeleteTrip] = useState(false);
  const [deletingTrip, setDeletingTrip] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [leavingTrip, setLeavingTrip] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [inviteMode, setInviteMode] = useState<"existing" | "new">("existing");
  const [inviteMemberId, setInviteMemberId] = useState<string | "">("");
  const [inviteNewName, setInviteNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInvite, setGeneratedInvite] = useState<GeneratedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Snapshot once per page load — "pending vs expired" doesn't need to be
  // live-reactive, and calling Date.now() at render time isn't pure.
  const [now] = useState(() => Date.now());
  const [fetchedInvitations, setFetchedInvitations] = useState<{
    tripId: string;
    list: Invitation[];
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Significant actions confirm via a bottom sheet before running.
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const [pendingArchive, setPendingArchive] = useState(false);

  const isOwner = data?.myRole === "owner";
  const tripId = data?.trip?.id ?? null;

  const renameValue =
    renameDraft?.tripId === tripId ? renameDraft.value : (data?.trip?.name ?? "");
  const descriptionValue =
    descriptionDraft?.tripId === tripId
      ? descriptionDraft.value
      : (data?.trip?.description ?? "");
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

  async function handleSaveDescription(e: FormEvent) {
    e.preventDefault();
    if (!tripId) return;
    setSavingDescription(true);
    try {
      await updateTripDescription(tripId, descriptionValue);
      await refresh();
      note("Description saved.");
    } catch (err) {
      fail(err);
    } finally {
      setSavingDescription(false);
    }
  }

  async function handleTransferOwnership(e: FormEvent) {
    e.preventDefault();
    if (!tripId || !transferTargetId) return;
    setTransferring(true);
    try {
      await transferTripOwnership(tripId, transferTargetId);
      setTransferTargetId("");
      await refresh();
      note("Ownership transferred.");
    } catch (err) {
      fail(err);
    } finally {
      setTransferring(false);
    }
  }

  async function handleDeleteTrip() {
    if (!tripId) return;
    setDeletingTrip(true);
    try {
      await deleteTrip(tripId);
      setPendingDeleteTrip(false);
      setDeleteConfirmText("");
      setSelectedTripId(null);
      await refresh();
      note("Trip deleted.");
      router.push("/");
    } catch (err) {
      fail(err);
      setPendingDeleteTrip(false);
    } finally {
      setDeletingTrip(false);
    }
  }

  async function handleLeaveTrip() {
    if (!tripId) return;
    setLeavingTrip(true);
    try {
      await leaveTrip(tripId);
      setPendingLeave(false);
      setSelectedTripId(null);
      await refresh();
      note("You left the trip.");
      router.push("/");
    } catch (err) {
      fail(err);
      setPendingLeave(false);
    } finally {
      setLeavingTrip(false);
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
    if (!tripId) return;
    const creatingGuest = effectiveInviteMode === "new";
    if (creatingGuest && !inviteNewName.trim()) return;
    if (!creatingGuest && !inviteMemberId) return;

    setBusy(true);
    try {
      const memberId = creatingGuest
        ? await addGuestMember(tripId, inviteNewName.trim())
        : inviteMemberId;
      const token = await inviteMember(tripId, memberId, inviteEmail.trim() || undefined);
      const memberName = creatingGuest
        ? inviteNewName.trim()
        : (data?.members.find((m) => m.id === memberId)?.name ?? "them");

      setGeneratedInvite({ link: buildInviteLink(token), memberName });
      setCopied(false);
      setInviteNewName("");
      setInviteMemberId("");
      setInviteEmail("");
      await Promise.all([
        refresh(),
        fetchInvitations(tripId).then((list) => setFetchedInvitations({ tripId, list })),
      ]);
      note("Invite link created.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      fail(new Error("Couldn't copy — long-press the link to copy it manually."));
    }
  }

  async function handleNativeShare(link: string, memberName: string, tripName: string) {
    try {
      await navigator.share({
        title: "Splitzy invite",
        text: `Join "${tripName}" on Splitzy as ${memberName}`,
        url: link,
      });
    } catch {
      // User cancelled the share sheet — not an error.
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
      setPendingRemove(null);
    } catch (err) {
      fail(err);
      setPendingRemove(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRole(memberId: string, role: "owner" | "member") {
    if (!tripId) return;
    setBusy(true);
    try {
      await setMemberRole(tripId, memberId, role);
      await refresh();
      note(role === "owner" ? "Promoted to owner." : "Changed to member.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleArchiveToggle() {
    if (!tripId || !data?.trip) return;
    const archiving = data.trip.status === "active";
    setBusy(true);
    try {
      await setTripStatus(tripId, archiving ? "archived" : "active");
      await refresh();
      note(archiving ? "Trip archived. Expenses stay readable; adding new ones is disabled." : "Trip reactivated.");
      setPendingArchive(false);
    } catch (err) {
      fail(err);
      setPendingArchive(false);
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
              className="tap grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
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
  // Can't default to "existing" with nothing to pick — fall back to "new"
  // for rendering without discarding the user's own toggle choice.
  const effectiveInviteMode = unclaimedMembers.length === 0 ? "new" : inviteMode;

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
                        : "border-transparent bg-line/60 hover:bg-line"
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
            className="tap grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
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
                    {/* Not truncated — a member roster exists to show who's
                        in the trip, so a long name must stay fully readable. */}
                    <span className="block text-sm font-medium leading-snug">
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
                    <span className="flex shrink-0 items-center gap-1">
                      {m.userId && (
                        <button
                          onClick={() =>
                            handleSetRole(
                              m.id,
                              m.role === "owner" ? "member" : "owner",
                            )
                          }
                          disabled={busy}
                          className="tap rounded-full px-2.5 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft disabled:opacity-60"
                        >
                          {m.role === "owner" ? "Make member" : "Make owner"}
                        </button>
                      )}
                      <button
                        onClick={() => setPendingRemove(m)}
                        disabled={busy}
                        className="tap rounded-full px-2.5 py-1.5 text-xs font-semibold text-negative transition-colors hover:bg-negative/10 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </span>
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
                  className="tap grid size-12 shrink-0 place-items-center rounded-2xl bg-line text-ink transition-[filter] hover:brightness-95 disabled:opacity-60"
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
                    className="tap shrink-0 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
                  >
                    Save
                  </button>
                </form>
              </div>

              <div>
                <h2 className="text-sm font-semibold">Description</h2>
                <form onSubmit={handleSaveDescription} className="mt-2 flex gap-2">
                  <textarea
                    value={descriptionValue}
                    onChange={(e) =>
                      setDescriptionDraft({ tripId: tripId!, value: e.target.value })
                    }
                    placeholder="What's this trip about?"
                    maxLength={280}
                    rows={2}
                    className="w-full resize-none rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={
                      savingDescription ||
                      descriptionValue.trim() === (data.trip.description ?? "")
                    }
                    className="tap shrink-0 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
                  >
                    Save
                  </button>
                </form>
              </div>

              <div>
                <h2 className="text-sm font-semibold">
                  {data.trip.status === "active" ? "Archive trip" : "Reactivate trip"}
                </h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {data.trip.status === "active"
                    ? "Archived trips stay readable but stop accepting new expenses."
                    : "This trip is archived — reactivate it to add expenses again."}
                </p>
                <button
                  onClick={() =>
                    data.trip!.status === "active"
                      ? setPendingArchive(true)
                      : handleArchiveToggle()
                  }
                  disabled={busy}
                  className={`tap mt-2 min-h-12 w-full rounded-2xl py-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
                    data.trip.status === "active"
                      ? "bg-negative/10 text-negative hover:bg-negative/15"
                      : "bg-brand text-white shadow-lg shadow-brand/25 hover:shadow-xl"
                  }`}
                >
                  {data.trip.status === "active" ? "Archive this trip" : "Reactivate this trip"}
                </button>
              </div>

              <div>
                <h2 className="text-sm font-semibold">Invite someone</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Generate a link for a specific person — they sign in and
                  claim exactly that identity, with its expense history.
                </p>

                <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl bg-line/60 p-1.5">
                  <button
                    type="button"
                    onClick={() => setInviteMode("existing")}
                    disabled={unclaimedMembers.length === 0}
                    aria-pressed={effectiveInviteMode === "existing"}
                    className={`tap rounded-xl py-2.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                      effectiveInviteMode === "existing"
                        ? "bg-surface-strong text-brand shadow-sm"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    Existing guest
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteMode("new")}
                    aria-pressed={effectiveInviteMode === "new"}
                    className={`tap rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                      effectiveInviteMode === "new"
                        ? "bg-surface-strong text-brand shadow-sm"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    New guest
                  </button>
                </div>

                <form onSubmit={handleInvite} className="mt-2 space-y-2">
                  {effectiveInviteMode === "existing" ? (
                    <select
                      value={inviteMemberId}
                      onChange={(e) => setInviteMemberId(e.target.value)}
                      className="min-h-12 w-full appearance-none rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                    >
                      <option value="">Choose a guest…</option>
                      {unclaimedMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={inviteNewName}
                      onChange={(e) => setInviteNewName(e.target.value)}
                      placeholder="Their name"
                      maxLength={60}
                      className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                    />
                  )}
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Their email (optional, just for your records)"
                    className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      (effectiveInviteMode === "existing" ? !inviteMemberId : !inviteNewName.trim())
                    }
                    className="tap w-full min-h-12 rounded-2xl bg-brand py-3 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
                  >
                    Generate invite link
                  </button>
                </form>

                {generatedInvite && (
                  <div className="anim-fade-in mt-3 space-y-2.5 rounded-2xl bg-brand-soft p-4">
                    <p className="text-sm font-semibold">
                      Link ready for {generatedInvite.memberName}
                    </p>
                    <p className="truncate rounded-xl bg-surface-strong px-3 py-2 text-xs text-ink-muted">
                      {generatedInvite.link}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyLink(generatedInvite.link)}
                        className="tap flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-surface-strong text-xs font-semibold transition-shadow hover:shadow-md"
                      >
                        <LinkIcon className="size-4" />
                        {copied ? "Copied!" : "Copy"}
                      </button>
                      <a
                        href={whatsappShareUrl(generatedInvite.link, data.trip.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tap flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-surface-strong text-xs font-semibold transition-shadow hover:shadow-md"
                      >
                        <WhatsAppIcon className="size-4" />
                        WhatsApp
                      </a>
                      {typeof navigator !== "undefined" && "share" in navigator && (
                        <button
                          type="button"
                          onClick={() =>
                            handleNativeShare(
                              generatedInvite.link,
                              generatedInvite.memberName,
                              data.trip!.name,
                            )
                          }
                          className="tap flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl bg-surface-strong text-xs font-semibold transition-shadow hover:shadow-md"
                        >
                          <ShareIcon className="size-4" />
                          Share
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {invitations.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {invitations.map((inv) => {
                      const expired = inv.expiresAt.getTime() < now;
                      return (
                        <li
                          key={inv.id}
                          className="flex min-h-12 items-center gap-3 rounded-2xl bg-line/60 px-4 py-2.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {inv.memberName ?? "Invite"}
                            </span>
                            <span className="text-xs text-ink-muted">
                              {expired ? "Expired" : "Pending"}
                              {inv.email ? ` · ${inv.email}` : ""}
                            </span>
                          </span>
                          <button
                            onClick={() => handleCopyLink(buildInviteLink(inv.token))}
                            disabled={busy || expired}
                            aria-label="Copy invite link"
                            className="tap rounded-full px-2.5 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft disabled:opacity-40"
                          >
                            <LinkIcon className="size-4" />
                          </button>
                          <button
                            onClick={() => handleRevoke(inv.id)}
                            disabled={busy}
                            className="tap rounded-full px-3 py-1.5 text-xs font-semibold text-negative transition-colors hover:bg-negative/10 disabled:opacity-60"
                          >
                            Revoke
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <h2 className="text-sm font-semibold">Transfer ownership</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  They become the owner; you become a regular member.
                </p>
                <form onSubmit={handleTransferOwnership} className="mt-2 flex gap-2">
                  <select
                    value={transferTargetId}
                    onChange={(e) => setTransferTargetId(e.target.value)}
                    className="min-h-12 w-full appearance-none rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
                  >
                    <option value="">Choose a member…</option>
                    {data.members
                      .filter((m) => m.id !== data.myMemberId && m.userId)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="submit"
                    disabled={transferring || !transferTargetId}
                    className="tap shrink-0 rounded-2xl bg-line px-4 text-sm font-semibold text-ink transition-[filter] hover:brightness-95 disabled:opacity-60"
                  >
                    Transfer
                  </button>
                </form>
              </div>

              <div className="border-t border-line pt-4">
                <h2 className="text-sm font-semibold text-negative">Delete trip</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Permanently removes this trip and every expense, member, and
                  settlement in it. This cannot be undone.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={`Type "${data.trip.name}" to confirm`}
                  className="mt-2 min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-negative"
                />
                <button
                  onClick={() => setPendingDeleteTrip(true)}
                  disabled={deleteConfirmText.trim() !== data.trip.name}
                  className="tap mt-2 min-h-12 w-full rounded-2xl bg-negative/10 py-3 text-sm font-semibold text-negative transition-colors hover:bg-negative/15 disabled:opacity-40"
                >
                  Delete this trip
                </button>
              </div>
            </section>
          )}

          {/* Leave trip: any member, including the owner (blocked server-side
              if they're the sole owner — must transfer ownership first). */}
          <section
            className="anim-fade-up glass rounded-3xl p-5"
            style={{ animationDelay: "150ms" }}
          >
            <h2 className="text-sm font-semibold">Leave trip</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              You&apos;ll lose access to {data.trip.name}. Your past expenses stay.
            </p>
            <button
              onClick={() => setPendingLeave(true)}
              disabled={!data.myMemberId}
              className="tap mt-2 min-h-12 w-full rounded-2xl bg-negative/10 py-3 text-sm font-semibold text-negative disabled:opacity-40"
            >
              Leave this trip
            </button>
          </section>
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

      <ConfirmSheet
        open={pendingRemove !== null}
        title={`Remove ${pendingRemove?.name ?? "member"}?`}
        message="They'll leave this trip, but their past expenses and balances stay exactly as they are."
        confirmLabel="Remove from trip"
        busyLabel="Removing…"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={() => pendingRemove && handleRemoveMember(pendingRemove.id)}
        onCancel={() => setPendingRemove(null)}
      />
      <ConfirmSheet
        open={pendingArchive}
        title={`Archive ${data?.trip?.name ?? "this trip"}?`}
        message="Everyone keeps read access to its expenses and balances, but no new expenses can be added until it's reactivated."
        confirmLabel="Archive trip"
        busyLabel="Archiving…"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={handleArchiveToggle}
        onCancel={() => setPendingArchive(false)}
      />
      <ConfirmSheet
        open={pendingDeleteTrip}
        title={`Delete ${data?.trip?.name ?? "this trip"}?`}
        message="This permanently removes the trip and everything in it — expenses, members, invitations, settlements. There's no undo."
        confirmLabel="Yes, delete permanently"
        busyLabel="Deleting…"
        cancelLabel="Cancel"
        busy={deletingTrip}
        onConfirm={handleDeleteTrip}
        onCancel={() => {
          if (!deletingTrip) setPendingDeleteTrip(false);
        }}
      />
      <ConfirmSheet
        open={pendingLeave}
        title={`Leave ${data?.trip?.name ?? "this trip"}?`}
        message="You'll lose access to this trip's expenses and balances. Your past expenses stay for everyone else."
        confirmLabel="Yes, leave"
        busyLabel="Leaving…"
        cancelLabel="Cancel"
        busy={leavingTrip}
        onConfirm={handleLeaveTrip}
        onCancel={() => {
          if (!leavingTrip) setPendingLeave(false);
        }}
      />
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up flex items-start justify-between pt-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Trips</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Switch trips, invite people, manage members.
        </p>
      </div>
      <Link
        href="/activity"
        className="tap mt-1 flex items-center gap-0.5 text-xs font-semibold text-brand"
      >
        Activity
        <ChevronRightIcon className="size-3.5" />
      </Link>
    </header>
  );
}
