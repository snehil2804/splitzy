"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, MapPinIcon } from "@/components/icons";
import { CardSkeleton } from "@/components/Skeleton";
import { SplitFields } from "@/components/SplitFields";
import { AccessDeniedState, EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
import { useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { addExpense, editExpense } from "@/lib/queries";
import { validateSplit } from "@/lib/splitValidation";
import type { SplitType } from "@/lib/types";

type SplitMode = "everyone" | "custom";

const PAYMENT_SUGGESTIONS = ["Cash", "GPay", "PhonePe", "Paytm"];

/**
 * Manual Add/Edit Expense form. Calls `add_expense()`/`edit_expense()`,
 * which own the split math and membership validation — this form only
 * collects input. `?edit=<expenseId>` switches it into edit mode, reusing
 * every field and the same split-input UI.
 */
export default function AddExpensePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Header editing={false} />
          <CardSkeleton lines={4} />
          <CardSkeleton lines={2} />
        </div>
      }
    >
      <AddExpenseFlow />
    </Suspense>
  );
}

function AddExpenseFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { status, data, error, refresh } = useTripData();
  const { session } = useSession();

  const editingExpense = data?.expenses.find((e) => e.id === editId) ?? null;
  const isEditing = editId !== null;
  const canEditThis =
    !isEditing ||
    !editingExpense ||
    data?.myRole === "owner" ||
    (session?.user.id != null && editingExpense.createdBy === session.user.id);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByOverride, setPaidByOverride] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("everyone");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [paymentApp, setPaymentApp] = useState("");
  const [locationName, setLocationName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  // Default payer = the signed-in user's member, unless overridden by a tap.
  const paidById = paidByOverride ?? data?.myMemberId ?? null;

  // Hydrate the form once per expense when opened in edit mode — guarded so
  // background refreshes (e.g. after another tab edits a different expense)
  // never clobber what the user is currently typing.
  const hydratedForId = useRef<string | null>(null);
  useEffect(() => {
    if (!editingExpense || !data) return;
    if (hydratedForId.current === editingExpense.id) return;
    hydratedForId.current = editingExpense.id;

    setDescription(editingExpense.description);
    setAmount(String(editingExpense.amount));
    setPaidByOverride(editingExpense.paidById);
    setCategory(editingExpense.category ?? "");
    setNotes(editingExpense.notes ?? "");
    setPaymentApp(editingExpense.paymentApp ?? "");
    setLocationName(editingExpense.locationName ?? "");
    setSplitType(editingExpense.splitType);

    const allMemberIds = data.members.map((m) => m.id).sort();
    const participantIds = [...editingExpense.participantIds].sort();
    const everyone =
      participantIds.length === allMemberIds.length &&
      participantIds.every((id, i) => id === allMemberIds[i]);
    setSplitMode(everyone ? "everyone" : "custom");
    setSelectedIds(new Set(editingExpense.participantIds));

    const values: Record<string, string> = {};
    for (const memberId of editingExpense.participantIds) {
      const shareAmount = editingExpense.shares[memberId] ?? 0;
      const value =
        editingExpense.splitType === "percentage"
          ? editingExpense.amount > 0
            ? (shareAmount / editingExpense.amount) * 100
            : 0
          : shareAmount;
      values[memberId] = value.toFixed(2);
    }
    setSplitValues(values);
  }, [editingExpense, data]);

  useEffect(() => {
    if (!succeeded) return;
    const timer = setTimeout(() => router.push("/expenses"), 900);
    return () => clearTimeout(timer);
  }, [succeeded, router]);

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateSplitValue(memberId: string, value: string) {
    setSplitValues((prev) => ({ ...prev, [memberId]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!data?.trip) {
      setFormError("There's no active trip to add this to.");
      return;
    }

    const trimmedDescription = description.trim();
    const amountValue = Number(amount);
    const payer = data.members.find((m) => m.id === paidById);
    const participantIds =
      splitMode === "everyone" ? data.members.map((m) => m.id) : [...selectedIds];

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

    const { error: splitError, splits } = validateSplit(
      splitType,
      participantIds,
      splitValues,
      amountValue,
    );
    if (splitError) {
      setFormError(splitError);
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      if (isEditing && editingExpense) {
        await editExpense({
          expenseId: editingExpense.id,
          description: trimmedDescription,
          amount: amountValue,
          paidById: payer.id,
          participantIds,
          paidAt: null,
          paymentApp: paymentApp.trim() || null,
          locationName: locationName.trim() || null,
          splitType,
          splits,
          category: category.trim() || null,
          notes: notes.trim() || null,
        });
      } else {
        await addExpense({
          tripId: data.trip.id,
          paidById: payer.id,
          amount: amountValue,
          description: trimmedDescription,
          participantIds,
          paymentApp: paymentApp.trim() || null,
          paidAt: new Date(),
          locationName: locationName.trim() || null,
          splitType,
          splits,
          category: category.trim() || null,
          notes: notes.trim() || null,
        });
      }
      await refresh();
      setSucceeded(true);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : `Couldn't ${isEditing ? "save that expense" : "add that expense"}.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "unconfigured") {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <SetupNotice />
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={2} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <ErrorState message={error ?? ""} onRetry={refresh} />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <AccessDeniedState onRetry={refresh} />
      </div>
    );
  }

  if (!data?.trip) {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <EmptyState
          emoji="🧳"
          title="No active trip"
          message="Create a trip first, then log your expenses here."
        />
      </div>
    );
  }

  if (isEditing && !editingExpense) {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <EmptyState
          emoji="🔍"
          title="Expense not found"
          message="It may have been deleted already. Head back to Expenses to check."
        />
      </div>
    );
  }

  if (isEditing && !canEditThis) {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <AccessDeniedState onRetry={refresh} />
      </div>
    );
  }

  if (data.trip.status !== "active") {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <EmptyState
          emoji="📦"
          title="This trip is archived"
          message="Archived trips are read-only. Reactivate it from the Trips page to add expenses."
        />
      </div>
    );
  }

  if (succeeded) {
    return (
      <div className="space-y-6">
        <Header editing={isEditing} />
        <div className="anim-fade-up flex flex-col items-center gap-3 rounded-[2rem] bg-gradient-to-br from-brand via-violet-500 to-accent p-10 text-center text-white shadow-xl shadow-brand/25">
          <span className="grid size-16 place-items-center rounded-full bg-white/20">
            <CheckIcon className="size-8" strokeWidth={2.4} />
          </span>
          <p className="text-lg font-bold">{isEditing ? "Saved!" : "Added!"}</p>
          <p className="text-sm text-white/85">Balances are updating now…</p>
        </div>
      </div>
    );
  }

  const { members, trip } = data;
  const participantIds = splitMode === "everyone" ? members.map((m) => m.id) : [...selectedIds];

  return (
    <div className="space-y-6 pb-4">
      <header className="anim-fade-up pt-2">
        <h1 className="text-2xl font-bold tracking-tight">
          {isEditing ? "Edit expense" : "Add expense"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">For {trip.name}</p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="anim-fade-up glass space-y-4 rounded-3xl p-5">
          <div>
            <label htmlFor="description" className="text-sm font-semibold">
              What was it for?
            </label>
            <input
              id="description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dinner at the beach shack"
              maxLength={120}
              className="mt-2 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="amount" className="text-sm font-semibold">
              Amount
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-faint">
                ₹
              </span>
              <input
                id="amount"
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
        </section>

        <section
          className="anim-fade-up glass rounded-3xl p-5"
          style={{ animationDelay: "60ms" }}
        >
          <h2 className="text-sm font-semibold">Who paid?</h2>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {members.map((m) => {
              const selected = paidById === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaidByOverride(m.id)}
                  aria-pressed={selected}
                  className={`tap flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-colors ${
                    selected
                      ? "border-brand bg-brand-soft"
                      : "border-transparent bg-line/60"
                  }`}
                >
                  <Avatar name={m.name} size="md" />
                  <span
                    className={`text-xs font-semibold ${selected ? "text-brand" : ""}`}
                  >
                    {m.name}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="anim-fade-up glass rounded-3xl p-5"
          style={{ animationDelay: "120ms" }}
        >
          <h2 className="text-sm font-semibold">Split with</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-line/60 p-1.5">
            <button
              type="button"
              onClick={() => setSplitMode("everyone")}
              aria-pressed={splitMode === "everyone"}
              className={`tap rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                splitMode === "everyone"
                  ? "bg-surface-strong text-brand shadow-sm"
                  : "text-ink-muted"
              }`}
            >
              Everyone
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("custom")}
              aria-pressed={splitMode === "custom"}
              className={`tap rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                splitMode === "custom"
                  ? "bg-surface-strong text-brand shadow-sm"
                  : "text-ink-muted"
              }`}
            >
              Choose people
            </button>
          </div>

          {splitMode === "custom" && (
            <div className="anim-fade-in mt-3 grid grid-cols-3 gap-2.5">
              {members.map((m) => {
                const selected = selectedIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.id)}
                    aria-pressed={selected}
                    className={`tap relative flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-colors ${
                      selected
                        ? "border-brand bg-brand-soft"
                        : "border-transparent bg-line/60"
                    }`}
                  >
                    {selected && (
                      <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-brand text-white">
                        <CheckIcon className="size-3" strokeWidth={3} />
                      </span>
                    )}
                    <Avatar name={m.name} size="md" />
                    <span
                      className={`text-xs font-semibold ${selected ? "text-brand" : ""}`}
                    >
                      {m.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <SplitFields
          splitType={splitType}
          onSplitTypeChange={setSplitType}
          members={members}
          participantIds={participantIds}
          values={splitValues}
          onValueChange={updateSplitValue}
          animationDelay="150ms"
        />

        <section
          className="anim-fade-up glass space-y-4 rounded-3xl p-5"
          style={{ animationDelay: "180ms" }}
        >
          <div>
            <label htmlFor="category" className="text-sm font-semibold">
              Category <span className="text-ink-faint">(optional)</span>
            </label>
            <input
              id="category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Food, Travel, Stay"
              maxLength={40}
              className="mt-2 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="notes" className="text-sm font-semibold">
              Notes <span className="text-ink-faint">(optional)</span>
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this expense"
              maxLength={280}
              rows={2}
              className="mt-2 w-full resize-none rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>

          <div>
            <h2 className="text-sm font-semibold">
              Payment app <span className="text-ink-faint">(optional)</span>
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {PAYMENT_SUGGESTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    setPaymentApp((prev) => (prev === option ? "" : option))
                  }
                  aria-pressed={paymentApp === option}
                  className={`tap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    paymentApp === option
                      ? "bg-brand text-white"
                      : "bg-line/60 text-ink-muted"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={paymentApp}
              onChange={(e) => setPaymentApp(e.target.value)}
              placeholder="Or type your own"
              maxLength={40}
              className="mt-2.5 w-full rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="location" className="text-sm font-semibold">
              Location <span className="text-ink-faint">(optional)</span>
            </label>
            <div className="relative mt-2">
              <MapPinIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
              <input
                id="location"
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="Where was this?"
                maxLength={80}
                className="w-full rounded-2xl border-2 border-transparent bg-line/60 py-3 pl-10 pr-4 text-sm outline-none transition-colors focus:border-brand"
              />
            </div>
          </div>
        </section>

        {formError && (
          <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="tap w-full rounded-2xl bg-gradient-to-br from-brand to-accent py-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 disabled:opacity-60"
        >
          {submitting
            ? isEditing
              ? "Saving…"
              : "Adding…"
            : isEditing
              ? "Save changes"
              : "Add expense"}
        </button>
      </form>
    </div>
  );
}

function Header({ editing }: { editing: boolean }) {
  return (
    <header className="anim-fade-up pt-2">
      <h1 className="text-2xl font-bold tracking-tight">
        {editing ? "Edit expense" : "Add expense"}
      </h1>
    </header>
  );
}
