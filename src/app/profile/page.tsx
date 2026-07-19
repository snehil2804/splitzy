"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { CardSkeleton } from "@/components/Skeleton";
import { SetupNotice } from "@/components/StateViews";
import { signOut, useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { fetchMyProfile, updateDisplayName } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export default function ProfilePage() {
  const router = useRouter();
  const { status: sessionStatus, session } = useSession();
  const { data } = useTripData();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchMyProfile()
      .then((p) => {
        setProfile(p);
        setDisplayName(p?.displayName ?? "");
      })
      .catch(() => setProfile(null))
      .finally(() => setProfileLoaded(true));
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

  async function handleSignOut() {
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
                className="tap shrink-0 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
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
            style={{ animationDelay: "120ms" }}
          >
            <h2 className="text-sm font-semibold">Account</h2>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="tap mt-3 min-h-12 w-full rounded-2xl bg-negative/10 py-3 text-sm font-semibold text-negative disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </section>
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up pt-2">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-ink-muted">Who you are across trips.</p>
    </header>
  );
}
