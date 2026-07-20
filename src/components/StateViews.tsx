"use client";

import Link from "next/link";
import { isNetworkError } from "@/lib/errors";
import { RefreshIcon } from "./icons";

/** Friendly empty / error / not-configured screens — never a blank page. */

interface EmptyStateProps {
  emoji: string;
  title: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ emoji, title, message, action }: EmptyStateProps) {
  return (
    <div className="anim-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="anim-float grid size-20 place-items-center rounded-[2rem] bg-brand-soft text-4xl">
        {emoji}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  // Only claim "it's the network" when it demonstrably was; otherwise stay
  // honest and generic. Raw error text (which may contain database
  // internals) is shown in development only — production logs it instead.
  const network = isNetworkError(message);
  if (process.env.NODE_ENV === "production") {
    console.error("Trip data failed to load:", message);
  }
  return (
    <div className="anim-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid size-20 place-items-center rounded-[2rem] bg-negative/10 text-4xl">
        🫠
      </div>
      <h2 className="text-lg font-semibold">That didn&apos;t work</h2>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
        {network
          ? "We couldn't reach the server — check your connection and try again."
          : "Something went wrong loading the trip data. Trying again usually fixes it."}
      </p>
      {process.env.NODE_ENV !== "production" && (
        <p className="max-w-xs break-words rounded-xl bg-line px-3 py-1.5 text-xs text-ink-faint">
          {message}
        </p>
      )}
      <button
        onClick={onRetry}
        className="tap mt-2 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl"
      >
        <RefreshIcon className="size-4" />
        Try again
      </button>
    </div>
  );
}

/**
 * Signed in, but RLS found no trip this account belongs to — distinct from
 * `ErrorState` because retrying alone won't fix it; the fix is joining or
 * creating a trip.
 */
export function AccessDeniedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="anim-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid size-20 place-items-center rounded-[2rem] bg-brand-soft text-4xl">
        🔒
      </div>
      <h2 className="text-lg font-semibold">Not on a trip yet</h2>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
        Your account isn&apos;t linked to any trip. Ask a trip owner to invite
        you, or create your own.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Link
          href="/trips"
          className="tap inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl"
        >
          Go to trips
        </Link>
        <button
          onClick={onRetry}
          className="tap inline-flex items-center gap-2 rounded-full bg-line/60 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-line"
        >
          <RefreshIcon className="size-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

export function SetupNotice() {
  return (
    <div className="anim-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="anim-float grid size-20 place-items-center rounded-[2rem] bg-brand-soft text-4xl">
        🔌
      </div>
      <h2 className="text-lg font-semibold">Almost there</h2>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
        Connect your Supabase project to bring Splitzy to life. Copy{" "}
        <code className="rounded-md bg-line px-1.5 py-0.5 text-xs">
          .env.local.example
        </code>{" "}
        to{" "}
        <code className="rounded-md bg-line px-1.5 py-0.5 text-xs">
          .env.local
        </code>{" "}
        and paste your project URL and anon key, then restart the dev server.
      </p>
    </div>
  );
}
