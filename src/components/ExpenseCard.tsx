"use client";

import { formatINR, formatTime } from "@/lib/format";
import type { Expense, Member } from "@/lib/types";
import { AvatarStack } from "./Avatar";
import { MapPinIcon, PencilIcon, TrashIcon } from "./icons";

interface ExpenseCardProps {
  expense: Expense;
  membersById: Map<string, Member>;
  onDelete?: (expense: Expense) => void;
  /** Only rendered when the signed-in member may edit this expense (creator only). */
  onEdit?: (expense: Expense) => void;
  /** Opens the full expense detail preview. When provided, the whole card becomes clickable. */
  onView?: (expense: Expense) => void;
  /** Compact rows for the dashboard's recent list. */
  compact?: boolean;
  /** Stagger index for the entrance animation. */
  index?: number;
}

export function ExpenseCard({
  expense,
  membersById,
  onDelete,
  onEdit,
  onView,
  compact = false,
  index = 0,
}: ExpenseCardProps) {
  const paidBy = membersById.get(expense.paidById)?.name ?? "Someone";
  const participantNames = expense.participantIds
    .map((id) => membersById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <article
      onClick={onView ? () => onView(expense) : undefined}
      onKeyDown={
        onView
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onView(expense);
              }
            }
          : undefined
      }
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      aria-label={onView ? `View details for ${expense.description}` : undefined}
      className={`anim-fade-up glass flex items-center gap-3.5 rounded-3xl p-4 ${onView ? "tap cursor-pointer" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-xl">
        {expense.emoji}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-snug">
          {expense.description}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {paidBy} paid
          {!compact && expense.paymentApp ? ` via ${expense.paymentApp}` : ""} ·{" "}
          {formatTime(expense.date)}
          {!compact && expense.locationName && (
            <span className="inline-flex items-center gap-0.5">
              {" · "}
              <MapPinIcon className="size-3" />
              {expense.locationName}
            </span>
          )}
        </p>
        {!compact && participantNames.length > 0 && (
          <div className="mt-2">
            <AvatarStack names={participantNames} />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-[15px] font-semibold tabular-nums">
          {formatINR(expense.amount)}
        </span>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(expense);
                }}
                aria-label={`Edit ${expense.description}`}
                className="tap -m-1 rounded-full p-1.5 text-ink-faint transition-colors hover:text-brand"
              >
                <PencilIcon className="size-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(expense);
                }}
                aria-label={`Delete ${expense.description}`}
                className="tap -m-1 rounded-full p-1.5 text-ink-faint transition-colors hover:text-negative"
              >
                <TrashIcon className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
