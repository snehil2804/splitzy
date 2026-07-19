import { expenseEmoji } from "./emoji";
import { getSupabase } from "./supabase";
import type {
  AddEqualExpenseInput,
  Expense,
  ExpenseRow,
  MemberRow,
  TripData,
  TripRow,
} from "./types";

/**
 * The only file that talks to Supabase. Queries follow the existing backend
 * schema exactly — see SETUP.md "Database contract" for the full shape.
 */

/** `trips.status` value that marks the trip currently in progress. */
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

export async function fetchTripData(): Promise<TripData> {
  const supabase = getSupabase();

  const [membersRes, tripsRes, expensesRes] = await Promise.all([
    supabase.from("members").select("*").eq("is_active", true).order("name"),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("*, expense_participants(*)")
      .is("deleted_at", null)
      .order("paid_at", { ascending: false }),
  ]);

  const firstError = membersRes.error ?? tripsRes.error ?? expensesRes.error;
  if (firstError) throw new Error(firstError.message);

  const members = (membersRes.data as MemberRow[]).map((m) => ({
    id: m.id,
    name: m.name,
  }));

  // The trip whose status is "active"; fall back to the newest trip so the
  // app still works between trips.
  const tripRows = tripsRes.data as TripRow[];
  const tripRow =
    tripRows.find((t) => t.status === TRIP_ACTIVE_STATUS) ?? tripRows[0];
  const trip = tripRow
    ? { id: tripRow.id, name: tripRow.name, status: tripRow.status }
    : null;

  const expenses = (expensesRes.data as ExpenseRow[])
    .filter((row) => !trip || row.trip_id === trip.id)
    .map(mapExpense);

  return { members, trip, expenses };
}

/**
 * Soft delete: stamps `deleted_at` / `deleted_by` / `deletion_reason`.
 * `deletedById` is the member using this device (null when identity is
 * unset in Settings).
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
 * Adds an expense via `POST /api/expenses`, which calls the existing
 * `add_equal_expense()` Postgres function server-side (that RPC is
 * service_role-only — the browser has no privilege to call it directly).
 * The split math, paise rounding, and participant validation all still live
 * exclusively in that Postgres function. Returns the new expense's id.
 */
export async function addEqualExpense(
  input: AddEqualExpenseInput,
): Promise<string> {
  const res = await fetch("/api/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tripId: input.tripId,
      paidByName: input.paidByName,
      amount: input.amount,
      description: input.description,
      participantNames: input.participantNames,
      paymentApp: input.paymentApp,
      paidAt: input.paidAt.toISOString(),
      locationName: input.locationName,
    }),
  });
  const body = (await res.json()) as { expenseId?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Couldn't add that expense.");
  return body.expenseId as string;
}
