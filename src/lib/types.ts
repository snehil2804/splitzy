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
  email: string | null;
  member_id: string | null;
  token: string;
  expires_at: string;
  role: "owner" | "member";
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  /** Present when selected with `members(name)`. */
  members: { name: string } | null;
}

export interface ExpenseParticipantRow {
  id: string;
  expense_id: string;
  member_id: string;
  share_amount: number | null;
  share_percentage: number | null;
  share_units: number | null;
  created_at: string;
}

export type SplitType = "equal" | "exact" | "percentage" | "shares";

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
  location_place_id: string | null;
  location_formatted_address: string | null;
  participant_count: number | null;
  share_per_person: number | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  created_by: string | null;
  split_type: SplitType;
  category: string | null;
  notes: string | null;
  currency: string;
  expense_participants: ExpenseParticipantRow[];
}

export interface SettlementRow {
  id: string;
  trip_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  note: string | null;
  settled_by: string | null;
  created_at: string;
}

export interface ActivityLogRow {
  id: string;
  trip_id: string;
  actor_member_id: string | null;
  action: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
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
  description: string | null;
  status: string;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Invitation {
  id: string;
  email: string | null;
  memberId: string | null;
  memberName: string | null;
  token: string;
  expiresAt: Date;
  role: "owner" | "member";
  status: "pending" | "accepted" | "revoked" | "declined";
}

export interface InvitationPreview {
  tripName: string;
  memberName: string;
  isValid: boolean;
}

/** A pending invitation addressed to the signed-in user's own email. */
export interface MyInvitation {
  id: string;
  token: string;
  tripName: string;
  memberName: string;
  inviterName: string;
  createdAt: Date;
  expiresAt: Date;
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
  /** Concise, human-friendly place name — what the UI shows (e.g. "Blue Tokai Coffee"). */
  locationName: string | null;
  /** Full address, stored for reference/future features — never shown as the primary label. */
  locationFormattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Google Places place_id, when picked from search/nearby/current-location. Null for manually typed locations. */
  locationPlaceId: string | null;
  /** When the payment happened (`paid_at`), not when the row was created. */
  date: Date;
  /** Auth user id of whoever logged it; null for pre-Stage-3 rows. */
  createdBy: string | null;
  splitType: SplitType;
  category: string | null;
  notes: string | null;
  currency: string;
}

export interface MemberBalance {
  member: Member;
  paid: number;
  share: number;
  /** paid − share; positive means the group owes them */
  net: number;
}

/** A suggested (not yet paid) settlement produced by `computeSettlements()`. */
export interface Settlement {
  from: Member;
  to: Member;
  amount: number;
}

/** An actually-recorded settlement, read back from the `settlements` table. */
export interface SettlementRecord {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  note: string | null;
  createdAt: Date;
}

export interface ActivityEntry {
  id: string;
  actorMemberId: string | null;
  action: string;
  description: string;
  createdAt: Date;
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
  settlements: SettlementRecord[];
}

/**
 * One participant's input for a non-equal split: an exact rupee amount, a
 * percentage, or a share count, depending on the expense's `splitType`.
 * Ignored entirely for `splitType: "equal"` — the RPC computes that split
 * from `participantIds` alone.
 */
export interface ExpenseSplitInput {
  memberId: string;
  value: number;
}

/**
 * A resolved location — from GPS auto-detection, the location picker
 * (current location / nearby / search), or typed manually (in which case
 * everything but `name` is null). One shape covers all three sources so
 * the Add/Edit Expense form only ever deals with one type.
 */
export interface LocationInput {
  /** Concise, human-friendly place name — what gets shown throughout the UI. */
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Google Places place_id. Null for manually typed locations. */
  placeId: string | null;
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
  location: LocationInput | null;
  splitType: SplitType;
  /** Required for exact/percentage/shares; ignored for equal. */
  splits: ExpenseSplitInput[] | null;
  category: string | null;
  notes: string | null;
}

/** Input for `editExpense()`. Maps to the `edit_expense()` RPC. */
export interface EditExpenseInput {
  expenseId: string;
  description: string;
  amount: number;
  paidById: string;
  participantIds: string[];
  paidAt: Date | null;
  paymentApp: string | null;
  location: LocationInput | null;
  splitType: SplitType;
  splits: ExpenseSplitInput[] | null;
  category: string | null;
  notes: string | null;
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
