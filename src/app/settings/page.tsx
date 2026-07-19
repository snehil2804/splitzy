"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  ChevronRightIcon,
  MailIcon,
  MoonIcon,
  SparklesIcon,
  SunIcon,
} from "@/components/icons";
import { useSession } from "@/hooks/useSession";
import { setThemePreference, useTheme } from "@/hooks/useTheme";
import { useTripData } from "@/hooks/useTripData";
import type { ThemePreference } from "@/lib/constants";
import { fetchMyInvitations } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * Deployed commit, inlined at build time. Vercel exposes this
 * automatically (System Environment Variables); locally it's absent.
 * Lets anyone confirm which build they're actually looking at.
 */
const BUILD_ID =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local dev";

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
  const theme = useTheme();
  const { data } = useTripData();
  const { session, status: sessionStatus } = useSession();
  const [invitationCount, setInvitationCount] = useState(0);

  const myMember = data?.myMemberId
    ? data.members.find((m) => m.id === data.myMemberId)
    : undefined;

  useEffect(() => {
    if (!isSupabaseConfigured || sessionStatus !== "authenticated") return;
    fetchMyInvitations()
      .then((list) => setInvitationCount(list.length))
      .catch(() => {});
  }, [sessionStatus]);

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Make Splitzy feel like yours.</p>
      </header>

      {/* Profile shortcut — identity comes from your account, not a picker */}
      <Link
        href="/profile"
        className="tap anim-fade-up glass flex min-h-14 items-center gap-3 rounded-3xl p-5"
      >
        <Avatar
          name={myMember?.name ?? session?.user.email ?? "?"}
          size="md"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {myMember?.name ?? "Your profile"}
          </span>
          <span className="block truncate text-xs text-ink-muted">
            {session?.user.email ?? "Signed in"}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-ink-faint" />
      </Link>

      {/* Invitations — badge shown only when something's waiting */}
      <Link
        href="/invitations"
        className="tap anim-fade-up glass flex min-h-14 items-center gap-3 rounded-3xl p-5"
        style={{ animationDelay: "30ms" }}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <MailIcon className="size-5" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold">Invitations</span>
        {invitationCount > 0 && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-negative text-[11px] font-bold text-white">
            {invitationCount}
          </span>
        )}
        <ChevronRightIcon className="size-4 shrink-0 text-ink-faint" />
      </Link>

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
                className={`tap flex min-h-11 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${
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
        <Link
          href="/trips"
          className="tap mt-3 flex min-h-14 items-center gap-3 rounded-2xl bg-line/60 p-4"
        >
          <span className="text-2xl">🧳</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {data?.trip?.name ?? "No trip selected"}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              {data?.members.length
                ? data.members.map((m) => m.name).join(" · ")
                : "Create or join a trip"}
            </span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-ink-faint" />
        </Link>
      </section>

      {/* About */}
      <section
        className="anim-fade-up glass rounded-3xl p-5"
        style={{ animationDelay: "180ms" }}
      >
        <h2 className="text-sm font-semibold">About</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Splitzy keeps trip money simple. Soon, an Apple Shortcut will log
          expenses automatically right after you pay via UPI — no typing at
          all.
        </p>
        <p className="mt-3 text-xs text-ink-faint">
          Splitzy v0.2 · Build {BUILD_ID} · Made with 💜
        </p>
      </section>
    </div>
  );
}
