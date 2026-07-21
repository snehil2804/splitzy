"use client";

import { useState, type ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { getExpensePermissions } from "@/lib/expensePermissions";
import { formatFullDateTime, formatINR } from "@/lib/format";
import type { Expense, Member, SplitType } from "@/lib/types";
import { Avatar } from "./Avatar";
import { ChevronRightIcon, MapPinIcon, PencilIcon, TrashIcon, XIcon } from "./icons";

interface ExpenseDetailSheetProps {
  expense: Expense;
  members: Member[];
  membersById: Map<string, Member>;
  tripName: string | null;
  myUserId: string | null;
  myRole: "owner" | "member" | null;
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  onDeleteRequest: (expense: Expense) => void;
}

const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  equal: "Equal split",
  exact: "Exact amounts",
  percentage: "Percentage split",
  shares: "Shares",
};

/**
 * Full read-only preview of everything saved for one expense, opened by
 * tapping a card on the Expenses page. Edit/Delete visibility mirrors
 * `getExpensePermissions()` exactly — the same rule the server enforces,
 * so this never offers an action the backend would reject.
 */
export function ExpenseDetailSheet({
  expense,
  members,
  membersById,
  tripName,
  myUserId,
  myRole,
  onClose,
  onEdit,
  onDeleteRequest,
}: ExpenseDetailSheetProps) {
  const [showTechnical, setShowTechnical] = useState(false);
  const dialogRef = useDialogA11y(true, onClose);

  const paidByMember = membersById.get(expense.paidById);
  const loggedByMember = expense.createdBy
    ? members.find((m) => m.userId === expense.createdBy)
    : undefined;

  const participants = expense.participantIds
    .map((id) => membersById.get(id))
    .filter((m): m is Member => Boolean(m))
    .map((m) => ({ member: m, share: expense.shares[m.id] ?? 0 }));

  const permissions = getExpensePermissions(expense, myUserId, myRole);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Expense details"
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
          <h2 className="text-lg font-semibold">Expense details</h2>
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
          {/* Hero */}
          <div className="flex items-center gap-3.5 border-b border-line/60 pb-5">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-2xl">
              {expense.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold leading-snug">{expense.description}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums">
                {formatINR(expense.amount)}
                {expense.currency !== "INR" && (
                  <span className="ml-1.5 text-sm font-medium text-ink-faint">
                    {expense.currency}
                  </span>
                )}
              </p>
            </div>
          </div>

          <Section title="Paid by">
            {paidByMember ? (
              <PersonRow member={paidByMember} />
            ) : (
              <p className="text-sm text-ink-muted">Unknown member</p>
            )}
          </Section>

          <Section title="Logged by">
            {loggedByMember ? (
              <PersonRow member={loggedByMember} />
            ) : (
              <p className="text-sm text-ink-muted">
                {expense.createdBy
                  ? "No longer a member of this trip"
                  : "Not recorded — added before this feature existed"}
              </p>
            )}
          </Section>

          <Section
            title={`Split between${participants.length > 0 ? ` · ${SPLIT_TYPE_LABELS[expense.splitType]} · ${participants.length} ${participants.length === 1 ? "person" : "people"}` : ""}`}
          >
            <div className="space-y-2">
              {participants.map(({ member, share }) => (
                <div key={member.id} className="flex items-center gap-3">
                  <Avatar name={member.name} size="sm" />
                  <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
                    {member.name}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatINR(share)}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Payment">
            <p className="text-sm">{expense.paymentApp ?? "Not specified"}</p>
          </Section>

          {(expense.locationName || expense.locationFormattedAddress) && (
            <Section title="Location">
              <div className="flex items-start gap-2">
                <MapPinIcon className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <div className="min-w-0">
                  {expense.locationName && <p className="text-sm font-medium">{expense.locationName}</p>}
                  {expense.locationFormattedAddress && (
                    <p className="mt-0.5 text-xs text-ink-muted">{expense.locationFormattedAddress}</p>
                  )}
                </div>
              </div>
            </Section>
          )}

          <Section title="Date and time">
            <p className="text-sm">{formatFullDateTime(expense.date)}</p>
          </Section>

          {tripName && (
            <Section title="Trip">
              <p className="text-sm">{tripName}</p>
            </Section>
          )}

          {(expense.category || expense.notes) && (
            <Section title="Notes">
              {expense.category && (
                <p className="text-sm">
                  <span className="text-ink-faint">Category: </span>
                  {expense.category}
                </p>
              )}
              {expense.notes && <p className="mt-1 text-sm">{expense.notes}</p>}
            </Section>
          )}

          {/* Secondary technical details — never prominent */}
          <div className="mt-4 border-t border-line/60 pt-3">
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="tap flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-faint transition-colors hover:text-ink-muted"
            >
              Technical details
              <ChevronRightIcon
                className={`size-3.5 transition-transform ${showTechnical ? "rotate-90" : ""}`}
              />
            </button>
            {showTechnical && (
              <dl className="anim-fade-in mt-2.5 space-y-1.5 text-xs text-ink-muted">
                {expense.latitude != null && expense.longitude != null && (
                  <div className="flex justify-between gap-3">
                    <dt>Coordinates</dt>
                    <dd className="tabular-nums">
                      {expense.latitude.toFixed(4)}, {expense.longitude.toFixed(4)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Logged</dt>
                  <dd>{formatFullDateTime(expense.recordCreatedAt)}</dd>
                </div>
                {expense.recordUpdatedAt && (
                  <div className="flex justify-between gap-3">
                    <dt>Last updated</dt>
                    <dd>{formatFullDateTime(expense.recordUpdatedAt)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Expense ID</dt>
                  <dd className="max-w-[60%] truncate">{expense.id}</dd>
                </div>
              </dl>
            )}
          </div>

          {/* Permission-gated actions */}
          {(permissions.canEdit || permissions.canDelete) && (
            <div className="mt-5 flex gap-2.5">
              {permissions.canEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(expense)}
                  className="tap flex flex-1 items-center justify-center gap-2 rounded-2xl bg-line/60 py-3 text-sm font-semibold transition-colors hover:bg-line"
                >
                  <PencilIcon className="size-4" />
                  Edit
                </button>
              )}
              {permissions.canDelete && (
                <button
                  type="button"
                  onClick={() => onDeleteRequest(expense)}
                  className="tap flex flex-1 items-center justify-center gap-2 rounded-2xl bg-negative/10 py-3 text-sm font-semibold text-negative transition-colors hover:bg-negative/15"
                >
                  <TrashIcon className="size-4" />
                  Delete
                </button>
              )}
            </div>
          )}
          {permissions.note && (
            <p className="mt-3 text-center text-xs leading-relaxed text-ink-faint">
              {permissions.note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line/60 py-4 last:border-b-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </div>
  );
}

function PersonRow({ member }: { member: Member }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={member.name} size="sm" />
      <span className="text-sm font-medium">{member.name}</span>
    </div>
  );
}
