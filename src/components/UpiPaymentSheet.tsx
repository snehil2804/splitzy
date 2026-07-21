"use client";

import { useMemo, useState } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { formatINR } from "@/lib/format";
import { recordSettlement } from "@/lib/queries";
import type { Settlement } from "@/lib/types";
import {
  buildUpiPaymentUri,
  maskUpiId,
  UPI_APP_LABELS,
  UPI_APP_OPEN_URIS,
} from "@/lib/upi";
import { CheckIcon, CopyIcon, WalletIcon, XIcon } from "./icons";

/**
 * CRED first because it is the one app confirmed on a real device to carry
 * an externally-initiated payment all the way through to success.
 *
 * The others are offered but genuinely may not complete: Google Pay in
 * particular resolves the payee (name and photo), accepts the UPI PIN, and
 * *then* declines at the switch with a misleading "you have exceeded your
 * payment limit" — even for ₹1, and even though paying the same person from
 * inside Google Pay works. That is Google Pay's own policy on payments
 * initiated from outside a UPI app to a personal VPA; the payload is
 * identical to the one CRED accepts, so there is nothing to fix on our
 * side. Sending these apps payment parameters therefore only walks the user
 * to a PIN prompt that cannot succeed, so they get a plain "open the app"
 * link and copy-then-paste is presented as the real path.
 */
const OPEN_ONLY_APPS = ["gpay", "phonepe", "paytm"] as const;

interface UpiPaymentSheetProps {
  settlement: Settlement;
  tripId: string;
  tripName: string;
  onClose: () => void;
  /** Called once a settlement is successfully recorded, so the parent can refresh trip data. */
  onSettled: () => void;
}

type Phase = "launch" | "confirm" | "confirmed";

/**
 * "Pay via UPI" bottom sheet. Opening a UPI app is only ever a convenience
 * deep link built from data the caller already re-verified as current
 * (`balances/page.tsx` reloads before opening this) — nothing here writes
 * anything until the user explicitly confirms via `record_settlement()`,
 * unchanged from the existing "mark as paid" flow.
 */
export function UpiPaymentSheet({
  settlement,
  tripId,
  tripName,
  onClose,
  onSettled,
}: UpiPaymentSheetProps) {
  const dialogRef = useDialogA11y(true, onClose);
  const online = useOnlineStatus();

  const [phase, setPhase] = useState<Phase>("launch");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);

  const recipientUpiId = settlement.to.upiId;

  /** Full payment link for CRED — the one app confirmed to complete these. */
  const credUri = useMemo(() => {
    if (!recipientUpiId) return null;
    try {
      return buildUpiPaymentUri(
        {
          recipientUpiId,
          recipientName: settlement.to.name,
          amount: settlement.amount,
          tripName,
        },
        "cred",
      );
    } catch {
      return null;
    }
  }, [recipientUpiId, settlement.to.name, settlement.amount, tripName]);

  async function copy(text: string, setCopied: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No reliable fallback in a sheet with no visible text field for the
      // amount/masked UPI ID — the values are still shown on screen to
      // copy by hand.
    }
  }

  async function handleConfirmPaid() {
    setSubmitting(true);
    setConfirmError(null);
    try {
      await recordSettlement(
        tripId,
        settlement.from.id,
        settlement.to.id,
        settlement.amount,
        note.trim() || null,
      );
      onSettled();
      setPhase("confirmed");
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : "Couldn't record that settlement.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Pay via UPI"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="anim-fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="anim-dialog-in glass relative flex max-h-[90vh] w-full max-w-sm flex-col rounded-t-[2rem] pb-[env(safe-area-inset-bottom)] outline-none md:max-w-md md:rounded-[2rem] md:pb-0"
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-lg font-semibold">Pay via UPI</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap -m-1.5 rounded-full p-1.5 text-ink-faint"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-5 pb-6">
          {phase !== "confirmed" && (
            <div className="border-b border-line/60 pb-5">
              <p className="text-3xl font-bold tabular-nums">{formatINR(settlement.amount)}</p>
              <p className="mt-1 text-sm text-ink-muted">
                From <span className="font-medium text-ink">You</span> to{" "}
                <span className="font-medium text-ink">{settlement.to.name}</span>
              </p>
              {recipientUpiId && (
                <p className="mt-2 rounded-xl bg-line/60 px-3 py-2 text-xs text-ink-muted">
                  {maskUpiId(recipientUpiId)} · {tripName}
                </p>
              )}
            </div>
          )}

          {phase === "launch" && (
            <div className="space-y-5 pt-5">
              {!recipientUpiId || !credUri ? (
                <p className="rounded-2xl bg-negative/10 p-4 text-center text-sm text-negative">
                  {settlement.to.name} hasn&apos;t added a UPI ID yet, so there&apos;s nothing to
                  pay to directly. Ask them to add one in Settings, or settle up another way.
                </p>
              ) : (
                <>
                  {!online && (
                    <p className="rounded-2xl bg-line/60 p-3 text-center text-xs text-ink-muted">
                      You&apos;re offline — opening a UPI app needs a connection. You can still
                      copy the details below.
                    </p>
                  )}

                  {/* Preferred path: the one app confirmed to carry an
                      externally-started payment through to completion. */}
                  <section>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-positive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-positive">
                        Recommended
                      </span>
                      <span className="text-xs text-ink-muted">Amount filled in for you</span>
                    </div>
                    <a
                      href={online ? credUri : undefined}
                      aria-disabled={!online}
                      onClick={(e) => {
                        if (!online) {
                          e.preventDefault();
                          return;
                        }
                        setPhase("confirm");
                      }}
                      className={`tap flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-brand to-accent text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow ${
                        online ? "hover:shadow-xl" : "pointer-events-none opacity-50"
                      }`}
                    >
                      <WalletIcon className="size-4" />
                      Pay {formatINR(settlement.amount)} with CRED
                    </a>
                  </section>

                  {/* Everything else: copy first, then open the app cold. */}
                  <section className="rounded-2xl bg-line/40 p-4">
                    <p className="text-sm font-semibold">Using another UPI app?</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      Google Pay, PhonePe and Paytm block payments started from outside their own
                      app — they&apos;ll take your PIN and then fail. Copy the UPI ID, open your
                      app, and paste it there instead.
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => copy(recipientUpiId, setCopiedUpi)}
                        className="tap flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-surface-strong text-sm font-semibold transition-shadow hover:shadow-md"
                      >
                        <CopyIcon className="size-4" />
                        {copiedUpi ? "Copied!" : "Copy UPI ID"}
                      </button>
                      <button
                        type="button"
                        onClick={() => copy(settlement.amount.toFixed(2), setCopiedAmount)}
                        className="tap flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-surface-strong text-sm font-semibold transition-shadow hover:shadow-md"
                      >
                        <CopyIcon className="size-4" />
                        {copiedAmount ? "Copied!" : "Copy amount"}
                      </button>
                    </div>

                    {online && (
                      <>
                        <p className="mt-3.5 text-xs font-medium text-ink-muted">Then open:</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {OPEN_ONLY_APPS.map((app) => (
                            <a
                              key={app}
                              href={UPI_APP_OPEN_URIS[app]}
                              onClick={() => setPhase("confirm")}
                              className="tap min-h-11 rounded-full bg-surface-strong px-4 py-2.5 text-xs font-semibold transition-shadow hover:shadow-md"
                            >
                              {UPI_APP_LABELS[app]}
                            </a>
                          ))}
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}

              <button
                type="button"
                onClick={onClose}
                data-autofocus
                className="tap min-h-11 w-full rounded-2xl py-2.5 text-sm font-semibold text-ink-muted transition-colors hover:bg-line/60"
              >
                Cancel
              </button>
            </div>
          )}

          {phase === "confirm" && (
            <div className="space-y-4 pt-5">
              <p className="text-center text-base font-semibold">Did you complete the payment?</p>
              <p className="text-center text-xs leading-relaxed text-ink-faint">
                Opening a UPI app doesn&apos;t confirm the payment went through — this just
                records what you tell Splitzy.
              </p>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reference number or note (optional)"
                maxLength={140}
                className="min-h-12 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
              />
              {confirmError && (
                <p className="rounded-2xl bg-negative/10 p-3 text-center text-sm font-medium text-negative">
                  {confirmError}
                </p>
              )}
              <div className="grid gap-2.5">
                <button
                  type="button"
                  onClick={handleConfirmPaid}
                  disabled={submitting}
                  className="tap flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-positive py-3 text-sm font-semibold text-white shadow-lg shadow-positive/25 transition-shadow hover:shadow-xl disabled:opacity-60"
                >
                  <CheckIcon className="size-4" strokeWidth={2.4} />
                  {submitting ? "Recording…" : "Yes, mark as paid"}
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("launch")}
                  disabled={submitting}
                  className="tap min-h-11 w-full rounded-2xl bg-line/60 py-2.5 text-sm font-semibold transition-colors hover:bg-line disabled:opacity-60"
                >
                  Payment failed
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="tap min-h-11 w-full rounded-2xl py-2.5 text-sm font-semibold text-ink-muted transition-colors hover:bg-line/60 disabled:opacity-60"
                >
                  Not yet
                </button>
              </div>
            </div>
          )}

          {phase === "confirmed" && (
            <div className="space-y-4 py-6 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-positive/10 text-positive">
                <CheckIcon className="size-7" strokeWidth={2.4} />
              </div>
              <div>
                <p className="text-base font-semibold">You confirmed this payment</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {formatINR(settlement.amount)} to {settlement.to.name} — balances updated.
                  This is self-reported, not verified by your bank or UPI provider.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="tap min-h-12 w-full rounded-2xl bg-line/60 text-sm font-semibold transition-colors hover:bg-line"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
