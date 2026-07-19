"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CheckIcon, MailIcon } from "@/components/icons";
import { CardSkeleton } from "@/components/Skeleton";
import { SetupNotice } from "@/components/StateViews";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
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
      <Suspense fallback={<CardSkeleton lines={2} />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up pt-10 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-[1.75rem] bg-gradient-to-br from-brand to-accent text-white shadow-xl shadow-brand/25">
        <MailIcon className="size-7" strokeWidth={2} />
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Sign in to Splitzy</h1>
      <p className="mt-1 text-sm text-ink-muted">
        We&apos;ll email you a link — no password needed.
      </p>
    </header>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(callbackError);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus("sending");
    setMessage(null);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          // Open signup: a brand-new email gets an account on first login.
          // Safe because RLS only shows trips you're an active member of —
          // a stranger who signs up sees an empty app, no trip data.
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Couldn't send that link.");
    }
  }

  if (status === "sent") {
    return (
      <div className="anim-fade-up flex flex-col items-center gap-3 rounded-[2rem] bg-gradient-to-br from-brand via-violet-500 to-accent p-10 text-center text-white shadow-xl shadow-brand/25">
        <span className="grid size-16 place-items-center rounded-full bg-white/20">
          <CheckIcon className="size-8" strokeWidth={2.4} />
        </span>
        <p className="text-lg font-bold">Check your email</p>
        <p className="text-sm text-white/85">
          We sent a sign-in link to {email.trim()}. Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="anim-fade-up space-y-4">
      <div className="glass rounded-3xl p-5">
        <label htmlFor="email" className="text-sm font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
        />
      </div>

      {message && (
        <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "sending" || !email.trim()}
        className="tap w-full rounded-2xl bg-gradient-to-br from-brand to-accent py-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
