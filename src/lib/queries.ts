import { expenseEmoji } from "./emoji";
import { getSupabase } from "./supabase";
import type {
  AddExpenseInput,
  Expense,
  ExpenseRow,
  Invitation,
  InvitationPreview,
  InvitationRow,
  Member,
  Profile,
  ProfileRow,
  TripData,
  TripMemberRow,
  TripRow,
} from "./types";

/**
 * The only file that talks to Supabase. All reads are RLS-scoped to the
 * signed-in user's trip memberships; all writes go through SECURITY DEFINER
 * RPCs (validation lives in Postgres, never duplicated here).
 */

/** `trips.status` value that marks a trip currently in progress. */
const TRIP_ACTIVE_STATUS = "active";

/** Recorded as `expenses.deletion_reason` for deletes made from this app. */
const DELETION_REASON = "Deleted from Splitzy web";

function mapExpense(row: ExpenseRow): Expense {
  const participants = row.expense_participants ?? [];
  const participantIds = participants.map((p) => p.member_id);
  // Preference order: explicit per-participant share → the expense's
  // equal-split share_per_person → derive from amount.
  const fallbackShare =
    row.share_per_person ??
    (participants.length > 0 ? row.amount / participants.length : 0);

  const shares: Record<string, number> = {};
  for (const participant of participants) {
    shares[participant.member_id] = participant.share_amount ?? fallbackShare;
  }

  return {
    id: row.id,
    tripId: row.trip_id,
    description: row.description,
    emoji: expenseEmoji(row.description),
    amount: row.amount,
    paidById: row.paid_by,
    paymentApp: row.payment_app,
    shares,
    participantIds,
    locationName: row.location_name,
    date: new Date(row.paid_at ?? row.created_at),
  };
}

/**
 * Loads everything the app needs for one render: the user's trips, the
 * selected trip's active members (via `trip_members` — membership is
 * per-trip now), and its live expenses. `selectedTripId` comes from the trip
 * switcher; falls back to the active trip, then the newest.
 */
export async function fetchTripData(
  selectedTripId: string | null,
): Promise<TripData> {
  const supabase = getSupabase();

  const [{ data: sessionData }, tripsRes] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
  ]);
  if (tripsRes.error) throw new Error(tripsRes.error.message);
  const userId = sessionData.session?.user.id ?? null;

  const tripRows = tripsRes.data as TripRow[];
  const trips = tripRows.map((t) => ({ id: t.id, name: t.name, status: t.status }));

  const tripRow =
    tripRows.find((t) => t.id === selectedTripId) ??
    tripRows.find((t) => t.status === TRIP_ACTIVE_STATUS) ??
    tripRows[0];
  const trip = tripRow
    ? { id: tripRow.id, name: tripRow.name, status: tripRow.status }
    : null;

  if (!trip) {
    return { trips, trip: null, members: [], myMemberId: null, myRole: null, expenses: [] };
  }

  const [membersRes, expensesRes] = await Promise.all([
    supabase
      .from("trip_members")
      .select("*, members(*)")
      .eq("trip_id", trip.id)
      .eq("is_active", true),
    supabase
      .from("expenses")
      .select("*, expense_participants(*)")
      .eq("trip_id", trip.id)
      .is("deleted_at", null)
      .order("paid_at", { ascending: false }),
  ]);
  const firstError = membersRes.error ?? expensesRes.error;
  if (firstError) throw new Error(firstError.message);

  const members: Member[] = (membersRes.data as TripMemberRow[])
    .filter((tm) => tm.members)
    .map((tm) => ({
      id: tm.members!.id,
      name: tm.members!.name,
      userId: tm.members!.user_id,
      role: tm.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const mine = userId ? members.find((m) => m.userId === userId) : undefined;

  const expenses = (expensesRes.data as ExpenseRow[]).map(mapExpense);

  return {
    trips,
    trip,
    members,
    myMemberId: mine?.id ?? null,
    myRole: mine?.role ?? null,
    expenses,
  };
}

/**
 * Soft delete: stamps `deleted_at` / `deleted_by` / `deletion_reason`.
 * RLS restricts this to members of the expense's trip, and a column-level
 * grant keeps every business column unwritable.
 */
export async function softDeleteExpense(
  expenseId: string,
  deletedById: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("expenses")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: deletedById,
      deletion_reason: DELETION_REASON,
    })
    .eq("id", expenseId);
  if (error) throw new Error(error.message);
}

/**
 * Adds an expense via the `add_expense()` RPC (SECURITY DEFINER). The RPC
 * validates trip membership for caller, payer, and every participant, and
 * owns the paise-exact split math. Returns the new expense's id.
 */
export async function addExpense(input: AddExpenseInput): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("add_expense", {
    p_trip_id: input.tripId,
    p_paid_by: input.paidById,
    p_amount: input.amount,
    p_description: input.description,
    p_participant_ids: input.participantIds,
    p_payment_app: input.paymentApp,
    p_paid_at: input.paidAt.toISOString(),
    p_location_name: input.locationName,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// ── Trip management ──────────────────────────────────────────────────────────

export async function createTrip(name: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("create_trip", {
    p_name: name,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Owner-only via RLS; the column grant limits what can change. */
export async function renameTrip(tripId: string, name: string): Promise<void> {
  const { error } = await getSupabase()
    .from("trips")
    .update({ name })
    .eq("id", tripId);
  if (error) throw new Error(error.message);
}

export async function setTripStatus(
  tripId: string,
  status: "active" | "completed" | "archived",
): Promise<void> {
  const { error } = await getSupabase()
    .from("trips")
    .update({ status })
    .eq("id", tripId);
  if (error) throw new Error(error.message);
}

// ── Member management (owner-only, enforced inside each RPC) ────────────────

export async function addGuestMember(
  tripId: string,
  name: string,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("add_guest_member", {
    p_trip_id: tripId,
    p_name: name,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Creates an invitation for a specific (already-existing) member and
 * returns its share token — the caller builds `/join/<token>` from it.
 * `email` is optional: when given, that address is auto-claimed on its
 * next login (see `accept_my_invitations`) in addition to the link.
 */
export async function inviteMember(
  tripId: string,
  memberId: string,
  email?: string | null,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("invite_member", {
    p_trip_id: tripId,
    p_member_id: memberId,
    p_email: email || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await getSupabase().rpc("revoke_invitation", {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
}

export async function setMemberActive(
  tripId: string,
  memberId: string,
  active: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("set_trip_member_active", {
    p_trip_id: tripId,
    p_member_id: memberId,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}

/**
 * Owner-only role change; the RPC refuses to demote the last active owner
 * (ownership transfer = promote the other person first).
 */
export async function setMemberRole(
  tripId: string,
  memberId: string,
  role: "owner" | "member",
): Promise<void> {
  const { error } = await getSupabase().rpc("set_trip_member_role", {
    p_trip_id: tripId,
    p_member_id: memberId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function fetchInvitations(tripId: string): Promise<Invitation[]> {
  const { data, error } = await getSupabase()
    .from("invitations")
    .select("*, members(name)")
    .eq("trip_id", tripId)
    .eq("status", "pending")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data as InvitationRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    memberId: row.member_id,
    memberName: row.members?.name ?? null,
    token: row.token,
    expiresAt: new Date(row.expires_at),
    role: row.role,
    status: row.status,
  }));
}

/** Public: works signed-out, so a link recipient can see what they're joining. */
export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  const { data, error } = await getSupabase().rpc("preview_invitation", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ trip_name: string; member_name: string; is_valid: boolean }>)[0];
  if (!row) return null;
  return { tripName: row.trip_name, memberName: row.member_name, isValid: row.is_valid };
}

/**
 * Claims an invitation as the signed-in caller — links the target member's
 * `user_id` to this account and joins the trip. Returns the trip id so the
 * caller can select it. The RPC is the sole source of truth for every
 * validity/ownership check; this function does no client-side gating.
 */
export async function claimInvitation(token: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("claim_invitation", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Accepts every pending invitation addressed to the signed-in email —
 * called once after login so invited users land in their trips (and claim
 * their pre-auth guest member identity) automatically.
 */
export async function acceptMyInvitations(): Promise<number> {
  const { data, error } = await getSupabase().rpc("accept_my_invitations");
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function fetchMyProfile(): Promise<Profile | null> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ProfileRow;
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function updateDisplayName(displayName: string): Promise<void> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
