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
  /** Linked auth user; null = guest member (no login). */
  user_id: string | null;
  created_at: string;
}

export interface TripRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TripMemberRow {
  id: string;
  trip_id: string;
  member_id: string;
  role: "owner" | "member";
  is_active: boolean;
  joined_at: string;
  members: MemberRow | null;
}

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  trip_id: string;
  email: string;
  member_id: string | null;
  role: "owner" | "member";
  status: "pending" | "accepted" | "revoked";
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
  /** Null for guest members (no login). */
  userId: string | null;
  role: "owner" | "member";
}

export interface Trip {
  id: string;
  name: string;
  status: string;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  memberId: string | null;
  role: "owner" | "member";
  status: "pending" | "accepted" | "revoked";
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
  /** Every trip the signed-in user belongs to (RLS-scoped), newest first. */
  trips: Trip[];
  /** The currently selected trip (from the switcher), or null if none. */
  trip: Trip | null;
  /** Active members of the selected trip. */
  members: Member[];
  /** The signed-in user's member identity, if linked. */
  myMemberId: string | null;
  myRole: "owner" | "member" | null;
  expenses: Expense[];
}

/**
 * Input for `addExpense()`. Maps to the `add_expense()` RPC (ID-based, any
 * trip size); the split itself is computed by that Postgres function, never
 * in the client.
 */
export interface AddExpenseInput {
  tripId: string;
  paidById: string;
  amount: number;
  description: string;
  participantIds: string[];
  paymentApp: string | null;
  paidAt: Date;
  locationName: string | null;
}

/**
 * Input for the legacy `POST /api/expenses` path (name-based
 * `add_equal_expense()`), kept for the future Apple Shortcut pipeline.
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
