"use client";

import { useDialogA11y } from "@/hooks/useDialogA11y";

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Shown on the confirm button while `busy` (default keeps delete copy). */
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** iOS-style bottom action sheet for destructive confirmations. */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  busyLabel = "Deleting…",
  cancelLabel = "Keep it",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const dialogRef = useDialogA11y(open, onCancel);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        aria-label="Cancel"
        onClick={onCancel}
        className="anim-fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="anim-dialog-in glass relative m-3 w-full max-w-sm rounded-[2rem] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] outline-none"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h2 className="text-center text-lg font-semibold">{title}</h2>
        <p className="mt-1.5 text-center text-sm leading-relaxed text-ink-muted">
          {message}
        </p>
        <div className="mt-6 grid gap-2.5">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="tap rounded-2xl bg-negative py-3.5 text-sm font-semibold text-white shadow-lg shadow-negative/25 transition-shadow hover:shadow-xl disabled:opacity-60"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            data-autofocus
            className="tap rounded-2xl bg-line py-3.5 text-sm font-semibold transition-[filter] hover:brightness-95"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
