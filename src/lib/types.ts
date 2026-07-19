/**
 * Database row shapes (matching the existing Supabase schema — see SETUP.md
 * "Database contract") and the view models the UI consumes. All balance math
 * lives in `balances.ts`; all row → view-model mapping lives in `queries.ts`,
 * so any backend change is a one-file fix.
 */

// ── Database rows ────────────────────────────────────────────────────────────

export interface MemberRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface TripRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface ExpenseParticipantRow {
  id: string;
  expense_id: string;
  member_id: string;
  share_amount: number | null;
  created_at: string;
}

export interface ExpenseRow {
  id: string;
  trip_id: string;
  paid_by: string;
  amount: number;
  description: string;
  payment_app: string | null;
  paid_at: string;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  participant_count: number | null;
  share_per_person: number | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  expense_participants: ExpenseParticipantRow[];
}

// ── View models ──────────────────────────────────────────────────────────────

export interface Member {
  id: string;
  name: string;
}

export interface Trip {
  id: string;
  name: string;
  status: string;
}

export interface Expense {
  id: string;
  tripId: string;
  description: string;
  emoji: string;
  amount: number;
  paidById: string;
  paymentApp: string | null;
  /** member id → their share of this expense */
  shares: Record<string, number>;
  participantIds: string[];
  locationName: string | null;
  /** When the payment happened (`paid_at`), not when the row was created. */
  date: Date;
}

export interface MemberBalance {
  member: Member;
  paid: number;
  share: number;
  /** paid − share; positive means the group owes them */
  net: number;
}

export interface Settlement {
  from: Member;
  to: Member;
  amount: number;
}

export interface TripData {
  members: Member[];
  trip: Trip | null;
  expenses: Expense[];
}

/**
 * Input for `addEqualExpense()`. Maps to `add_equal_expense()`'s params by
 * name inside `queries.ts`; the split itself is computed by that Postgres
 * function, never in the client.
 */
export interface AddEqualExpenseInput {
  tripId: string;
  /** Matched against `members.name` server-side, not a member id. */
  paidByName: string;
  amount: number;
  description: string;
  /** Also matched against `members.name`; who the amount is split between. */
  participantNames: string[];
  paymentApp: string | null;
  paidAt: Date;
  locationName: string | null;
}
