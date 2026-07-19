"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { MoonIcon, SparklesIcon, SunIcon } from "@/components/icons";
import { setIdentity, useIdentity } from "@/hooks/useIdentity";
import { signOut, useSession } from "@/hooks/useSession";
import { setThemePreference, useTheme } from "@/hooks/useTheme";
import { useTripData } from "@/hooks/useTripData";
import type { ThemePreference } from "@/lib/constants";

/** Shown until the member list arrives from Supabase. */
const DEFAULT_MEMBERS = ["Snehil", "Shruti", "Anshul"];

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  Icon: typeof SunIcon;
}> = [
  { value: "system", label: "Auto", Icon: SparklesIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

export default function SettingsPage() {
  const identity = useIdentity();
  const theme = useTheme();
  const { data } = useTripData();
  const { status: sessionStatus, session } = useSession();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const memberNames = data?.members.length
    ? data.members.map((m) => m.name)
    : DEFAULT_MEMBERS;

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.push("/login");
  }

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Make Splitzy feel like yours.</p>
      </header>

      {/* Identity */}
      <section className="anim-fade-up glass rounded-3xl p-5">
        <h2 className="text-sm font-semibold">Who are you?</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Used for greetings and &quot;you owe&quot; framing on this device.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {memberNames.map((name) => {
            const selected = identity?.toLowerCase() === name.toLowerCase();
            return (
              <button
                key={name}
                onClick={() => setIdentity(selected ? null : name)}
                aria-pressed={selected}
                className={`tap flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-colors ${
                  selected
                    ? "border-brand bg-brand-soft"
                    : "border-transparent bg-line/60"
                }`}
              >
                <Avatar name={name} size="md" />
                <span
                  className={`text-xs font-semibold ${selected ? "text-brand" : ""}`}
                >
                  {name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Appearance */}
      <section
        className="anim-fade-up glass rounded-3xl p-5"
        style={{ animationDelay: "60ms" }}
      >
        <h2 className="text-sm font-semibold">Appearance</h2>
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-line/60 p-1.5">
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
            const selected = theme === value;
            return (
              <button
                key={value}
                onClick={() => setThemePreference(value)}
                aria-pressed={selected}
                className={`tap flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                  selected
                    ? "bg-surface-strong text-brand shadow-sm"
                    : "text-ink-muted"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Trip */}
      <section
        className="anim-fade-up glass rounded-3xl p-5"
        style={{ animationDelay: "120ms" }}
      >
        <h2 className="text-sm font-semibold">Trip</h2>
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-line/60 p-4">
          <span className="text-2xl">🧳</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {data?.trip?.name ?? "Loading trip…"}
            </p>
            <p className="text-xs text-ink-muted">
              {memberNames.join(" · ")}
            </p>
          </div>
        </div>
      </section>

      {/* Account */}
      {sessionStatus === "authenticated" && (
        <section
          className="anim-fade-up glass rounded-3xl p-5"
          style={{ animationDelay: "150ms" }}
        >
          <h2 className="text-sm font-semibold">Account</h2>
          {session?.user.email && (
            <p className="mt-0.5 text-xs text-ink-muted">
              Signed in as {session.user.email}
            </p>
          )}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="tap mt-3 w-full rounded-2xl bg-negative/10 py-3 text-sm font-semibold text-negative disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </section>
      )}

      {/* About */}
      <section
        className="anim-fade-up glass rounded-3xl p-5"
        style={{ animationDelay: "180ms" }}
      >
        <h2 className="text-sm font-semibold">About</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Splitzy keeps trip money simple for three friends. Soon, an Apple
          Shortcut will log expenses automatically right after you pay via UPI
          — no typing at all.
        </p>
        <p className="mt-3 text-xs text-ink-faint">Splitzy v0.1 · Made with 💜</p>
      </section>
    </div>
  );
}
