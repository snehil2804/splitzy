"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, CrosshairIcon, MapPinIcon } from "@/components/icons";
import { LocationPicker } from "@/components/LocationPicker";
import { CardSkeleton } from "@/components/Skeleton";
import { SplitFields } from "@/components/SplitFields";
import { AccessDeniedState, EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { PAYMENT_SUGGESTIONS } from "@/lib/constants";
import { getExpensePermissions } from "@/lib/expensePermissions";
import { addExpense, editExpense } from "@/lib/queries";
import { validateSplit } from "@/lib/splitValidation";
import type { LocationInput, SplitType } from "@/lib/types";

type SplitMode = "everyone" | "custom";

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
    getExpensePermissions(editingExpense, session?.user.id ?? null, data?.myRole ?? null).canEdit;

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByOverride, setPaidByOverride] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("everyone");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [paymentApp, setPaymentApp] = useState("");
  // Only ever set by the user (manual pick) or by edit-mode hydration.
  // Auto-detection is never copied in here — it's applied as a fallback
  // below, purely at render/derivation time.
  const [manualLocation, setManualLocation] = useState<LocationInput | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  // Default payer = the signed-in user's member, unless overridden by a tap.
  const paidById = paidByOverride ?? data?.myMemberId ?? null;

  // Smart Location: request/read GPS in the background and resolve it to a
  // named place, entirely automatic — only while genuinely showing the Add
  // form for an active trip (never mid-edit, where we shouldn't silently
  // override the expense's original location with wherever the device is
  // right now).
  const autoDetectEnabled =
    !isEditing && !!data?.trip && data.trip.status === "active" && !succeeded;
  const { status: geoStatus, place: autoDetectedPlace } = useCurrentLocation(autoDetectEnabled);

  // The auto-detected place is only ever used as a fallback for display/
  // submission — never copied into state — so a manual pick always wins
  // immediately with no risk of a slower GPS result clobbering it later.
  const location: LocationInput | null =
    manualLocation ??
    (!isEditing && autoDetectedPlace
      ? {
          name: autoDetectedPlace.name,
          formattedAddress: autoDetectedPlace.formattedAddress,
          latitude: autoDetectedPlace.latitude,
          longitude: autoDetectedPlace.longitude,
          placeId: autoDetectedPlace.placeId,
        }
      : null);
  const locationSource: "auto" | "manual" | null = manualLocation
    ? "manual"
    : location
      ? "auto"
      : null;

  function handleLocationPicked(picked: LocationInput) {
    setManualLocation(picked);
    setPickerOpen(false);
  }

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
    setManualLocation(
      editingExpense.locationName
        ? {
            name: editingExpense.locationName,
            formattedAddress: editingExpense.locationFormattedAddress,
            latitude: editingExpense.latitude,
            longitude: editingExpense.longitude,
            placeId: editingExpense.locationPlaceId,
          }
        : null,
    );
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
    // After an edit, return to that expense's preview rather than the
    // plain list, so the user sees their change reflected immediately.
    const destination =
      isEditing && editingExpense ? `/expenses?view=${editingExpense.id}` : "/expenses";
    const timer = setTimeout(() => router.push(destination), 900);
    return () => clearTimeout(timer);
  }, [succeeded, router, isEditing, editingExpense]);

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
          location,
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
          location,
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
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
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
                      : "border-transparent bg-line/60 hover:bg-line"
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
                  : "text-ink-muted hover:text-ink"
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
                  : "text-ink-muted hover:text-ink"
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
                        : "border-transparent bg-line/60 hover:bg-line"
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
                      : "bg-line/60 text-ink-muted hover:bg-line"
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
            <span className="text-sm font-semibold">
              Location <span className="text-ink-faint">(optional)</span>
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="tap mt-2 flex w-full items-center gap-3 rounded-2xl border-2 border-transparent bg-line/60 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-line focus:border-brand"
            >
              {locationSource === "auto" ? (
                <CrosshairIcon className="size-4 shrink-0 text-brand" />
              ) : (
                <MapPinIcon className="size-4 shrink-0 text-ink-faint" />
              )}
              <span className="min-w-0 flex-1">
                {location ? (
                  <span className="flex items-center gap-2">
                    <span className="truncate">{location.name}</span>
                    {locationSource && (
                      <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                        {locationSource === "auto" ? "Auto-detected" : "Selected"}
                      </span>
                    )}
                  </span>
                ) : geoStatus === "locating" ? (
                  <span className="text-ink-faint">Finding your location…</span>
                ) : geoStatus === "denied" ? (
                  <span className="text-ink-faint">Location access denied — tap to search</span>
                ) : (
                  <span className="text-ink-faint">Where was this?</span>
                )}
              </span>
            </button>
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
          className="tap w-full rounded-2xl bg-gradient-to-br from-brand to-accent py-4 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-shadow hover:shadow-xl disabled:opacity-60 disabled:hover:shadow-lg"
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

      {pickerOpen && (
        <LocationPicker
          onClose={() => setPickerOpen(false)}
          onSelect={handleLocationPicked}
          autoDetectedPlace={autoDetectedPlace}
          coords={
            autoDetectedPlace
              ? { latitude: autoDetectedPlace.latitude, longitude: autoDetectedPlace.longitude }
              : null
          }
        />
      )}
    </div>
  );
}

function Header({ editing }: { editing: boolean }) {
  return (
    <header className="anim-fade-up pt-2">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
        {editing ? "Edit expense" : "Add expense"}
      </h1>
    </header>
  );
}
