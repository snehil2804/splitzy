"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CardSkeleton } from "@/components/Skeleton";
import { SetupNotice } from "@/components/StateViews";
import { setSelectedTripId } from "@/hooks/useSelectedTrip";
import { useSession } from "@/hooks/useSession";
import { claimInvitation, previewInvitation } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { InvitationPreview } from "@/lib/types";

type Phase = "loading" | "invalid" | "ready" | "claiming" | "claimed" | "claim-error";

/**
 * Public invite landing page — reachable signed-out (see PUBLIC_PATHS in
 * supabase-middleware.ts). Shows who/what the link is for via the anon-safe
 * `preview_invitation` RPC, then once the visitor is signed in, claims the
 * invitation automatically. The token alone is the credential; no email
 * matching happens here.
 */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimAttempted = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    previewInvitation(token)
      .then((p) => {
        if (cancelled) return;
        if (!p || !p.isValid) {
          setPhase("invalid");
        } else {
          setPreview(p);
          setPhase("ready");
        }
      })
      .catch(() => !cancelled && setPhase("invalid"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (phase !== "ready" || sessionStatus !== "authenticated") return;
    if (claimAttempted.current) return;
    claimAttempted.current = true;
    setPhase("claiming");
    claimInvitation(token)
      .then((tripId) => {
        setSelectedTripId(tripId);
        setPhase("claimed");
        router.push("/");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't join that trip.");
        setPhase("claim-error");
      });
  }, [phase, sessionStatus, token, router]);

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

      {(phase === "loading" || phase === "claiming") && <CardSkeleton lines={3} />}

      {phase === "invalid" && (
        <StatusCard
          emoji="🔒"
          title="This invite isn't available"
          message="The link may have expired, already been used, or been revoked. Ask the trip owner for a new one."
        />
      )}

      {phase === "claim-error" && (
        <StatusCard emoji="🫠" title="Couldn't join" message={error ?? ""} />
      )}

      {phase === "claimed" && (
        <StatusCard emoji="🎉" title="You're in!" message="Taking you to the trip…" />
      )}

      {phase === "ready" && preview && sessionStatus !== "authenticated" && (
        <div className="anim-fade-up glass rounded-3xl p-6 text-center">
          <span className="text-3xl">🧳</span>
          <h2 className="mt-3 text-lg font-semibold">
            Join {preview.tripName} as {preview.memberName}
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Sign in to accept — you&apos;ll appear as{" "}
            <span className="font-semibold">{preview.memberName}</span> and see the
            trip&apos;s existing expenses and balances.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
            className="tap mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent px-5 text-sm font-semibold text-white shadow-lg shadow-brand/25"
          >
            Continue to sign in
          </Link>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="anim-fade-up pt-10 text-center">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">You&apos;re invited</h1>
    </header>
  );
}

function StatusCard({
  emoji,
  title,
  message,
}: {
  emoji: string;
  title: string;
  message: string;
}) {
  return (
    <div className="anim-fade-up flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid size-20 place-items-center rounded-[2rem] bg-brand-soft text-4xl">
        {emoji}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">{message}</p>
      <Link href="/" className="tap mt-2 text-sm font-semibold text-brand">
        Go to Splitzy
      </Link>
    </div>
  );
}
