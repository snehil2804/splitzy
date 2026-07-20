"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { ChevronRightIcon, CheckIcon, CrosshairIcon } from "@/components/icons";
import { EmptyState } from "@/components/StateViews";
import { useOfflineGps } from "@/hooks/useOfflineGps";
import { useOfflineIdentity } from "@/hooks/useOfflineIdentity";
import { refreshOfflineQueue } from "@/hooks/useOfflineQueue";
import { formatINR } from "@/lib/format";
import { getLatestReferenceDataForUser, getOfflineExpense, saveOfflineExpense } from "@/lib/offlineDb";
import type { OfflineExpense, OfflineReferenceData } from "@/lib/offlineTypes";

type SplitMode = "everyone" | "custom";

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function OfflineAddExpensePage() {
  return (
    <Suspense fallback={<FormShell><Loading /></FormShell>}>
      <OfflineAddExpenseFlow />
    </Suspense>
  );
}

function OfflineAddExpenseFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editLocalId = searchParams.get("edit");
  const isEditing = editLocalId !== null;
  const { status: identityStatus, userId } = useOfflineIdentity();

  const [reference, setReference] = useState<OfflineReferenceData | null | undefined>(undefined);
  const [editingExpense, setEditingExpense] = useState<OfflineExpense | null | undefined>(
    isEditing ? undefined : null,
  );

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // Only ever set by a manual tap or edit-mode hydration — the default
  // (signed-in member) is derived below, never pushed in via an effect.
  const [paidByOverride, setPaidByOverride] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("everyone");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentApp, setPaymentApp] = useState("");
  const [paidAtLocal, setPaidAtLocal] = useState(() => toDatetimeLocalValue(new Date()));
  const [notes, setNotes] = useState("");
  const [manualLocation, setManualLocation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const gps = useOfflineGps(!isEditing);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getLatestReferenceDataForUser(userId).then((data) => {
      if (!cancelled) setReference(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!editLocalId) return;
    // Wait for identity to resolve (it can arrive late via the offline
    // fallback path) rather than checking ownership against a still-null
    // userId — that would incorrectly reject a valid edit as "not found."
    if (!userId) return;
    let cancelled = false;
    getOfflineExpense(editLocalId).then((existing) => {
      if (cancelled) return;
      if (!existing || existing.created_by_user_id !== userId) {
        setEditingExpense(null);
        return;
      }
      setEditingExpense(existing);
      setDescription(existing.description);
      setAmount(String(existing.amount));
      setPaidByOverride(existing.paid_by_member_id);
      setSplitMode("custom");
      setSelectedIds(new Set(existing.participant_ids));
      setPaymentApp(existing.payment_app_or_method ?? "");
      setPaidAtLocal(toDatetimeLocalValue(new Date(existing.paid_at)));
      setNotes(existing.notes ?? "");
      setManualLocation(existing.manual_location_name ?? "");
    });
    return () => {
      cancelled = true;
    };
    // userId's *value* is stable for a signed-in user across token
    // refreshes, so re-running only when it actually changes (null → an
    // id) is exactly the desired behavior, not a source of clobbering.
  }, [editLocalId, userId]);

  // Default payer = the signed-in member, unless overridden by a tap or
  // edit-mode hydration — derived, never imperatively pushed via an effect.
  const defaultPaidById = reference
    ? (reference.members.find((m) => m.name === reference.user_display_name)?.id ??
      reference.members[0]?.id ??
      null)
    : null;
  const paidById = paidByOverride ?? defaultPaidById;

  const participantIds =
    splitMode === "everyone" ? (reference?.members.map((m) => m.id) ?? []) : [...selectedIds];

  function toggleParticipant(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reference || !userId) return;

    const trimmedDescription = description.trim();
    const amountValue = Number(amount);
    const payer = reference.members.find((m) => m.id === paidById);

    if (!trimmedDescription) {
      setFormError("Add a short description.");
      return;
    }
    if (!amount.trim() || !Number.isFinite(amountValue) || amountValue <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    if (!payer) {
      setFormError("Choose who paid.");
      return;
    }
    if (participantIds.length === 0) {
      setFormError("Pick at least one person to split with.");
      return;
    }
    const paidAt = new Date(paidAtLocal);
    if (Number.isNaN(paidAt.getTime())) {
      setFormError("Enter a valid date and time.");
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const participantNames = participantIds
        .map((id) => reference.members.find((m) => m.id === id)?.name)
        .filter((n): n is string => Boolean(n));

      const record: OfflineExpense = {
        local_id: editingExpense?.local_id ?? crypto.randomUUID(),
        idempotency_key: editingExpense?.idempotency_key ?? crypto.randomUUID(),
        trip_id: reference.trip_id,
        trip_name: reference.trip_name,
        created_by_user_id: userId,
        created_by_display_name: reference.user_display_name,
        paid_by_member_id: payer.id,
        paid_by_name: payer.name,
        amount: amountValue,
        currency: reference.default_currency,
        description: trimmedDescription,
        participant_ids: participantIds,
        participant_names: participantNames,
        participant_count: participantIds.length,
        share_per_person: Math.round((amountValue / participantIds.length) * 100) / 100,
        split_method: "equal",
        payment_app_or_method: paymentApp.trim() || null,
        paid_at: paidAt.toISOString(),
        manual_location_name: manualLocation.trim() || null,
        latitude: gps.coords?.latitude ?? editingExpense?.latitude ?? null,
        longitude: gps.coords?.longitude ?? editingExpense?.longitude ?? null,
        notes: notes.trim() || null,
        created_offline_at: editingExpense?.created_offline_at ?? now,
        updated_offline_at: now,
        // Editing a failed record gives it a clean slate to retry.
        sync_status: "pending",
        sync_attempt_count: 0,
        last_sync_error: null,
        synced_expense_id: null,
      };

      await saveOfflineExpense(record);
      await refreshOfflineQueue(userId);
      router.push("/offline");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save that expense.");
    } finally {
      setSaving(false);
    }
  }

  if (identityStatus === "loading" || (isEditing && editingExpense === undefined) || reference === undefined) {
    return (
      <FormShell isEditing={isEditing}>
        <Loading />
      </FormShell>
    );
  }

  if (identityStatus === "signed-out" || !userId) {
    return (
      <FormShell isEditing={isEditing}>
        <EmptyState
          emoji="🔒"
          title="Sign in required"
          message="Open Splitzy once while connected and sign in to prepare Offline Mode."
        />
      </FormShell>
    );
  }

  if (!reference) {
    return (
      <FormShell isEditing={isEditing}>
        <EmptyState
          emoji="🔌"
          title="Offline Mode isn't ready yet"
          message="Open Splitzy once while connected to prepare Offline Mode."
        />
      </FormShell>
    );
  }

  if (isEditing && !editingExpense) {
    return (
      <FormShell isEditing={isEditing}>
        <EmptyState
          emoji="🔍"
          title="Not found"
          message="This offline expense may have already synced or been deleted on this device."
        />
      </FormShell>
    );
  }

  return (
    <FormShell isEditing={isEditing}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="anim-fade-up glass space-y-4 rounded-3xl p-5">
          <div>
            <label htmlFor="offline-description" className="text-sm font-semibold">
              What was it for?
            </label>
            <input
              id="offline-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Tea at the dhaba"
              maxLength={120}
              className="mt-2 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="offline-amount" className="text-sm font-semibold">
              Amount
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-faint">
                ₹
              </span>
              <input
                id="offline-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full rounded-2xl border-2 border-transparent bg-line/60 py-3 pl-8 pr-4 text-sm tabular-nums outline-none transition-colors focus:border-brand"
              />
            </div>
          </div>
          <div>
            <label htmlFor="offline-paid-at" className="text-sm font-semibold">
              Date and time
            </label>
            <input
              id="offline-paid-at"
              type="datetime-local"
              value={paidAtLocal}
              onChange={(e) => setPaidAtLocal(e.target.value)}
              className="mt-2 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>
        </section>

        <section className="anim-fade-up glass rounded-3xl p-5" style={{ animationDelay: "60ms" }}>
          <h2 className="text-sm font-semibold">Who paid?</h2>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {reference.members.map((m) => {
              const selected = paidById === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaidByOverride(m.id)}
                  aria-pressed={selected}
                  className={`tap flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-colors ${
                    selected ? "border-brand bg-brand-soft" : "border-transparent bg-line/60 hover:bg-line"
                  }`}
                >
                  <Avatar name={m.name} size="md" />
                  <span className={`text-xs font-semibold ${selected ? "text-brand" : ""}`}>{m.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="anim-fade-up glass rounded-3xl p-5" style={{ animationDelay: "120ms" }}>
          <h2 className="text-sm font-semibold">Split equally with</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-line/60 p-1.5">
            <button
              type="button"
              onClick={() => setSplitMode("everyone")}
              aria-pressed={splitMode === "everyone"}
              className={`tap rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                splitMode === "everyone" ? "bg-surface-strong text-brand shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              Everyone
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("custom")}
              aria-pressed={splitMode === "custom"}
              className={`tap rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                splitMode === "custom" ? "bg-surface-strong text-brand shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              Choose people
            </button>
          </div>

          {splitMode === "custom" && (
            <div className="anim-fade-in mt-3 grid grid-cols-3 gap-2.5">
              {reference.members.map((m) => {
                const selected = selectedIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleParticipant(m.id)}
                    aria-pressed={selected}
                    className={`tap relative flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-colors ${
                      selected ? "border-brand bg-brand-soft" : "border-transparent bg-line/60 hover:bg-line"
                    }`}
                  >
                    {selected && (
                      <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-brand text-white">
                        <CheckIcon className="size-3" strokeWidth={3} />
                      </span>
                    )}
                    <Avatar name={m.name} size="md" />
                    <span className={`text-xs font-semibold ${selected ? "text-brand" : ""}`}>{m.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {amount.trim() && Number(amount) > 0 && participantIds.length > 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              {formatINR(Math.round((Number(amount) / participantIds.length) * 100) / 100)} per person
              · {participantIds.length} {participantIds.length === 1 ? "person" : "people"}
            </p>
          )}
        </section>

        <section className="anim-fade-up glass space-y-4 rounded-3xl p-5" style={{ animationDelay: "180ms" }}>
          <div>
            <h2 className="text-sm font-semibold">
              Payment method <span className="text-ink-faint">(optional)</span>
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {reference.payment_methods.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPaymentApp((prev) => (prev === option ? "" : option))}
                  aria-pressed={paymentApp === option}
                  className={`tap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    paymentApp === option ? "bg-brand text-white" : "bg-line/60 text-ink-muted hover:bg-line"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="offline-location" className="text-sm font-semibold">
              Location <span className="text-ink-faint">(optional)</span>
            </label>
            <input
              id="offline-location"
              type="text"
              value={manualLocation}
              onChange={(e) => setManualLocation(e.target.value)}
              placeholder="e.g. Roadside dhaba, Manali"
              maxLength={120}
              className="mt-2 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
            {!isEditing && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint">
                <CrosshairIcon className="size-3.5 shrink-0" />
                {gps.status === "locating" && "Finding your coordinates…"}
                {gps.status === "done" && "GPS coordinates attached to this expense."}
                {gps.status === "unavailable" && "No GPS coordinates available — that's fine."}
                {gps.status === "idle" && " "}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="offline-notes" className="text-sm font-semibold">
              Notes <span className="text-ink-faint">(optional)</span>
            </label>
            <textarea
              id="offline-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
              maxLength={280}
              rows={2}
              className="mt-2 w-full resize-none rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>
        </section>

        {formError && (
          <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="tap w-full rounded-2xl bg-gradient-to-br from-brand to-accent py-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60"
        >
          {saving ? "Saving…" : isEditing ? "Save changes" : "Save offline expense"}
        </button>
      </form>
    </FormShell>
  );
}

function FormShell({ children, isEditing }: { children: React.ReactNode; isEditing?: boolean }) {
  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <Link
          href="/offline"
          className="tap flex items-center gap-0.5 text-xs font-semibold text-brand transition-opacity hover:opacity-70"
        >
          <ChevronRightIcon className="size-3.5 rotate-180" />
          Back to Offline Mode
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
          {isEditing ? "Edit offline expense" : "Add offline expense"}
        </h1>
      </header>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div className="glass anim-fade-up rounded-3xl p-5 text-center text-sm text-ink-muted">Loading…</div>
  );
}
