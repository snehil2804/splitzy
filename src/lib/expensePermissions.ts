import type { Expense } from "./types";

/**
 * Single source of truth for "who can edit/delete this expense" — mirrors
 * the server-side rule exactly (edit_expense()'s permission check, and the
 * expenses_update_owner_or_creator RLS policy for delete), so the UI never
 * offers an action the backend would reject:
 *
 *   - Edit: the expense's creator only. Never the trip owner, never
 *     derived from who paid. Legacy expenses (created before creator
 *     tracking existed, `createdBy === null`) can never be edited by
 *     anyone.
 *   - Delete: the creator OR the trip owner (a moderation/cleanup power —
 *     it does not grant edit access). This is also how legacy expenses
 *     stay removable at all: only the trip owner can delete them.
 */
export interface ExpensePermissions {
  canEdit: boolean;
  canDelete: boolean;
  /** Why edit/delete are limited, for a subtle explanatory note — null when the viewer is the creator (nothing to explain). */
  note: string | null;
}

export function getExpensePermissions(
  expense: Pick<Expense, "createdBy">,
  myUserId: string | null,
  myRole: "owner" | "member" | null,
): ExpensePermissions {
  const isCreator = myUserId != null && expense.createdBy != null && expense.createdBy === myUserId;
  const isOwner = myRole === "owner";
  const isLegacy = expense.createdBy === null;

  if (isCreator) {
    return { canEdit: true, canDelete: true, note: null };
  }

  if (isOwner) {
    return {
      canEdit: false,
      canDelete: true,
      note: isLegacy
        ? "This expense was logged before creator tracking existed — you can remove it, but no one can edit it."
        : "You can remove this expense, but only the person who logged it can edit its details.",
    };
  }

  return {
    canEdit: false,
    canDelete: false,
    note: "Only the person who logged this expense can edit or delete it.",
  };
}
