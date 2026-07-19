"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GoogleIcon, MailIcon } from "@/components/icons";
import { CardSkeleton } from "@/components/Skeleton";
import { SetupNotice } from "@/components/StateViews";
import { authErrorCopy, classifyAuthError, AUTH_ERROR_COPY, safeNextPath } from "@/lib/auth-errors";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Sign-in: Google OAuth first (works in every context, including the
 * installed iOS home-screen app), then a same-screen email verification
 * code — chosen over link-tapping because the emailed link opens in a
 * separate browser on iOS PWAs, stranding the session. The emailed message
 * also carries a link for people who prefer it on desktop.
 */

const RESEND_COOLDOWN_S = 30;
// This project issues 8-digit codes (verified live); accept 6-8 so a
// dashboard change to the standard 6 keeps working without a deploy.
const OTP_MIN = 6;
const OTP_MAX = 8;

type Step = "start" | "otp";

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
      <Suspense fallback={<CardSkeleton lines={3} />}>
        <LoginFlow />
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
        Split trips fairly — no passwords needed.
      </p>
    </header>
  );
}

function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const initialError = authErrorCopy(searchParams.get("auth_error"));

  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState<"google" | "send" | "verify" | null>(null);
  const [message, setMessage] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step === "otp") otpRef.current?.focus();
  }, [step]);

  const normalizedEmail = email.trim().toLowerCase();

  function friendly(raw: string): string {
    return AUTH_ERROR_COPY[classifyAuthError(raw)];
  }

  async function handleGoogle() {
    if (busy) return;
    setBusy("google");
    setMessage(null);
    try {
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      // Success: the browser is navigating to Google — keep the busy state.
    } catch (err) {
      console.error("Google sign-in failed to start:", err);
      setMessage(AUTH_ERROR_COPY.oauth_failed);
      setBusy(null);
    }
  }

  async function sendCode(isResend = false) {
    if (busy || !normalizedEmail) return;
    if (isResend && cooldown > 0) return;
    setBusy("send");
    setMessage(null);
    setNotice(null);
    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          // Open signup stays on; the emailed link (for those who prefer it)
          // must land on our cross-context-safe callback.
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      setStep("otp");
      setOtp("");
      setCooldown(RESEND_COOLDOWN_S);
      if (isResend) setNotice("New code sent.");
    } catch (err) {
      console.error("Sending sign-in code failed:", err);
      setMessage(friendly(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(null);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    const token = otp.replace(/\D/g, "");
    if (busy || token.length < OTP_MIN || token.length > OTP_MAX) return;
    setBusy("verify");
    setMessage(null);
    try {
      const { error } = await getSupabase().auth.verifyOtp({
        email: normalizedEmail,
        token,
        type: "email",
      });
      if (error) throw error;
      router.push(next);
      router.refresh();
    } catch (err) {
      console.error("Code verification failed:", err);
      const raw = err instanceof Error ? err.message : "";
      const code = classifyAuthError(raw);
      setMessage(
        code === "auth_failed" ? AUTH_ERROR_COPY.otp_invalid : AUTH_ERROR_COPY[code],
      );
      setBusy(null);
    }
  }

  if (step === "otp") {
    return (
      <form onSubmit={handleVerify} className="anim-fade-up space-y-4">
        <div className="glass rounded-3xl p-5">
          <h2 className="text-sm font-semibold">Enter your code</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            We emailed a verification code to{" "}
            <span className="font-semibold">{normalizedEmail}</span>. Keep this
            screen open, copy the code from the email, and enter it here. (The
            link in the email works too, if you&apos;d rather tap that on this
            device.)
          </p>
          <input
            ref={otpRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_MAX}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_MAX))}
            placeholder="12345678"
            aria-label="Verification code"
            className="mt-3 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-center text-xl font-bold tracking-[0.25em] tabular-nums outline-none transition-colors focus:border-brand"
          />
          <div className="mt-3 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep("start");
                setOtp("");
                setMessage(null);
                setNotice(null);
              }}
              className="tap font-semibold text-ink-muted"
            >
              Change email
            </button>
            <button
              type="button"
              onClick={() => sendCode(true)}
              disabled={cooldown > 0 || busy !== null}
              className="tap font-semibold text-brand disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </div>

        {notice && (
          <p className="anim-fade-in rounded-2xl bg-positive/10 p-3 text-center text-sm font-medium text-positive">
            {notice}
          </p>
        )}
        {message && (
          <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={busy !== null || otp.length < OTP_MIN}
          className="tap min-h-12 w-full rounded-2xl bg-gradient-to-br from-brand to-accent py-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
        >
          {busy === "verify" ? "Verifying…" : "Verify and sign in"}
        </button>
      </form>
    );
  }

  return (
    <div className="anim-fade-up space-y-4">
      <button
        onClick={handleGoogle}
        disabled={busy !== null}
        className="tap glass flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl py-3.5 text-sm font-semibold disabled:opacity-60"
      >
        <GoogleIcon className="size-5" />
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="flex items-center gap-3 px-2" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs font-medium text-ink-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
        className="space-y-3"
      >
        <div className="glass rounded-3xl p-5">
          <label htmlFor="email" className="text-sm font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
          />
          <p className="mt-2 text-xs text-ink-muted">
            We&apos;ll email you a verification code to type in here — recommended
            on iPhone, where sign-in links can open in the wrong browser.
          </p>
        </div>

        {message && (
          <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={busy !== null || !normalizedEmail}
          className="tap min-h-12 w-full rounded-2xl bg-gradient-to-br from-brand to-accent py-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
        >
          {busy === "send" ? "Sending…" : "Send verification code"}
        </button>
      </form>
    </div>
  );
}
