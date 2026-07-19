"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { ExpenseCard } from "@/components/ExpenseCard";
import { ListSkeleton } from "@/components/Skeleton";
import { AccessDeniedState, EmptyState, ErrorState, SetupNotice } from "@/components/StateViews";
import { useSession } from "@/hooks/useSession";
import { useTripData } from "@/hooks/useTripData";
import { totalSpent } from "@/lib/balances";
import { dayKey, formatDayLabel, formatINR } from "@/lib/format";
import type { Expense } from "@/lib/types";

export default function ExpensesPage() {
  const router = useRouter();
  const { status, data, error, refresh, deleteExpense } = useTripData();
  const { session } = useSession();
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const membersById = useMemo(
    () => new Map((data?.members ?? []).map((m) => [m.id, m])),
    [data?.members],
  );

  const myUserId = session?.user.id ?? null;
  const canEdit = (expense: Expense) =>
    data?.myRole === "owner" || (myUserId !== null && expense.createdBy === myUserId);

  /** Expenses grouped by calendar day, newest day first. */
  const days = useMemo(() => {
    const groups = new Map<string, { label: string; expenses: Expense[] }>();
    for (const expense of data?.expenses ?? []) {
      const key = dayKey(expense.date);
      const group = groups.get(key) ?? {
        label: formatDayLabel(expense.date),
        expenses: [],
      };
      group.expenses.push(expense);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [data?.expenses]);

  /** Member id for `expenses.deleted_by`, from the signed-in account. */
  const myMemberId = data?.myMemberId ?? null;

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteExpense(pendingDelete.id, myMemberId);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Couldn't delete that expense",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="anim-fade-up pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
        {status === "ready" && data && data.expenses.length > 0 && (
          <p className="mt-1 text-sm text-ink-muted">
            {data.expenses.length}{" "}
            {data.expenses.length === 1 ? "expense" : "expenses"} ·{" "}
            {formatINR(totalSpent(data.expenses))} total
          </p>
        )}
      </header>

      {status === "unconfigured" && <SetupNotice />}
      {status === "loading" && <ListSkeleton count={6} />}
      {status === "error" && <ErrorState message={error ?? ""} onRetry={refresh} />}
      {status === "forbidden" && <AccessDeniedState onRetry={refresh} />}

      {status === "ready" && days.length === 0 && (
        <EmptyState
          emoji="🧾"
          title="Nothing here yet"
          message="Expenses land here automatically once you start paying — or add one with the + button."
        />
      )}

      {status === "ready" &&
        days.map((day) => (
          <section key={day.label + day.expenses[0]?.id}>
            <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              {day.label}
            </h2>
            <div className="space-y-3">
              {day.expenses.map((expense, i) => (
                <ExpenseCard
                  key={expense.id}
                  expense={expense}
                  membersById={membersById}
                  onDelete={setPendingDelete}
                  onEdit={
                    canEdit(expense)
                      ? (e) => router.push(`/add?edit=${e.id}`)
                      : undefined
                  }
                  index={i}
                />
              ))}
            </div>
          </section>
        ))}

      {deleteError && (
        <p className="anim-fade-in rounded-2xl bg-negative/10 p-4 text-center text-sm font-medium text-negative">
          {deleteError} — pull yourself a chai and try again.
        </p>
      )}

      <ConfirmSheet
        open={pendingDelete !== null}
        title="Delete this expense?"
        message={
          pendingDelete
            ? `"${pendingDelete.description}" (${formatINR(pendingDelete.amount)}) will be removed for everyone and balances will update.`
            : ""
        }
        confirmLabel="Yes, delete it"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </div>
  );
}
