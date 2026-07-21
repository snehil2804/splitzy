"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { CardSkeleton } from "@/components/Skeleton";
import { SetupNotice } from "@/components/StateViews";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { signOut, useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { fetchMyProfile, fetchMyUpiId, updateDisplayName, updateMyUpiId } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { validateUpiId } from "@/lib/upi";

export default function ProfilePage() {
  const router = useRouter();
  const { status: sessionStatus, session } = useSession();
  const { data } = useTripData();
  const { pendingCount: offlinePendingCount } = useOfflineQueue(session?.user.id ?? null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [upiId, setUpiId] = useState("");
  const [savingUpi, setSavingUpi] = useState(false);
  const [upiMessage, setUpiMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchMyProfile()
      .then((p) => {
        setProfile(p);
        setDisplayName(p?.displayName ?? "");
      })
      .catch(() => setProfile(null))
      .finally(() => setProfileLoaded(true));
    fetchMyUpiId()
      .then((id) => setUpiId(id ?? ""))
      .catch(() => {});
  }, [sessionStatus]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateDisplayName(displayName.trim());
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveUpi(e: FormEvent) {
    e.preventDefault();
    const result = validateUpiId(upiId);
    if (!result.valid) {
      setUpiMessage(result.error ?? "That doesn't look like a valid UPI ID.");
      return;
    }
    setSavingUpi(true);
    setUpiMessage(null);
    try {
      await updateMyUpiId(result.normalized || null);
      setUpiId(result.normalized);
      setUpiMessage(result.normalized ? "Saved." : "Removed.");
    } catch (err) {
      setUpiMessage(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSavingUpi(false);
    }
  }

  function requestSignOut() {
    if (offlinePendingCount > 0) {
      setConfirmingSignOut(true);
      return;
    }
    void handleSignOut();
  }

  async function handleSignOut() {
    setConfirmingSignOut(false);
    setSigningOut(true);
    await signOut();
    router.push("/login");
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6">
        <Header />
        <SetupNotice />
      </div>
    );
  }

  const myMember = data?.myMemberId
    ? data.members.find((m) => m.id === data.myMemberId)
    : undefined;
  const email = session?.user.email ?? profile?.email ?? "";

  return (
    <div className="space-y-6">
      <Header />

      {sessionStatus === "loading" || !profileLoaded ? (
        <CardSkeleton lines={3} />
      ) : (
        <>
          <section className="anim-fade-up glass rounded-3xl p-5">
            <div className="flex items-center gap-4">
              <Avatar name={myMember?.name ?? (displayName || email || "?")} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {myMember?.name ?? (displayName || "New here")}
                </p>
                <p className="truncate text-sm text-ink-muted">{email}</p>
              </div>
            </div>
            {myMember && data?.trip && (
              <p className="mt-3 text-xs text-ink-muted">
                You appear as <span className="font-semibold">{myMember.name}</span>{" "}
                in {data.trip.name}
                {myMember.role === "owner" ? " (owner)" : ""}.
              </p>
            )}
          </section>

          <section
            className="anim-fade-up glass rounded-3xl p-5"
            style={{ animationDelay: "60ms" }}
          >
            <h2 className="text-sm font-semibold">Display name</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Used when you create or join new trips.
            </p>
            <form onSubmit={handleSave} className="mt-3 flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={60}
                className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
              />
              <button
                type="submit"
                disabled={saving || !displayName.trim()}
                className="tap shrink-0 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
              >
                {saving ? "…" : "Save"}
              </button>
            </form>
            {message && (
              <p className="anim-fade-in mt-2 text-xs font-medium text-ink-muted">
                {message}
              </p>
            )}
          </section>

          <section
            className="anim-fade-up glass rounded-3xl p-5"
            style={{ animationDelay: "90ms" }}
          >
            <h2 className="text-sm font-semibold">UPI ID</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Lets other trip members pay you directly from a settlement suggestion.
            </p>
            <form onSubmit={handleSaveUpi} className="mt-3 flex gap-2">
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourname@bank"
                maxLength={256}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
              />
              <button
                type="submit"
                disabled={savingUpi}
                className="tap shrink-0 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
              >
                {savingUpi ? "…" : "Save"}
              </button>
            </form>
            {upiMessage && (
              <p className="anim-fade-in mt-2 text-xs font-medium text-ink-muted">{upiMessage}</p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Saving a UPI ID does not prove bank ownership — Splitzy can&apos;t verify it belongs
              to you. Only add your own, and clear it any time by saving an empty field.
            </p>
          </section>

          <section
            className="anim-fade-up glass rounded-3xl p-5"
            style={{ animationDelay: "150ms" }}
          >
            <h2 className="text-sm font-semibold">Account</h2>
            <button
              onClick={requestSignOut}
              disabled={signingOut}
              className="tap mt-3 min-h-12 w-full rounded-2xl bg-negative/10 py-3 text-sm font-semibold text-negative transition-colors hover:bg-negative/15 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </section>
        </>
      )}

      <ConfirmSheet
        open={confirmingSignOut}
        title="Sign out with expenses still pending?"
        message={`You have ${offlinePendingCount} offline ${offlinePendingCount === 1 ? "expense" : "expenses"} on this device that ${offlinePendingCount === 1 ? "hasn't" : "haven't"} synced yet. They'll stay saved here, but only this account can sync or manage them — sign back in to finish.`}
        confirmLabel="Sign out anyway"
        busyLabel="Signing out…"
        cancelLabel="Stay signed in"
        busy={signingOut}
        onConfirm={handleSignOut}
        onCancel={() => {
          if (!signingOut) setConfirmingSignOut(false);
        }}
      />
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up pt-2">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Profile</h1>
      <p className="mt-1 text-sm text-ink-muted">Who you are across trips.</p>
    </header>
  );
}
