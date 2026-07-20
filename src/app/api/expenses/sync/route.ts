import { NextResponse } from "next/server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * Server-side sync endpoint for the offline expense queue. Unlike the
 * legacy `/api/expenses` (which exists only because `add_equal_expense()`
 * is `service_role`-only), this uses the caller's own cookie-authenticated,
 * RLS-scoped client — `add_expense()` is already `authenticated`-callable
 * directly. The endpoint exists specifically to own idempotency handling
 * around that RPC, not to duplicate its validation: trip membership, payer/
 * participant membership, amount/description checks, and split math all
 * still live in the RPC, which is the single source of truth either way.
 *
 * `created_by` is never accepted from the client — the RPC derives it from
 * `auth.uid()` inside a `SECURITY DEFINER` function, so a tampered creator
 * id in the request body is structurally impossible to honor.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SyncRequestBody {
  idempotencyKey?: unknown;
  tripId?: unknown;
  paidByMemberId?: unknown;
  amount?: unknown;
  description?: unknown;
  participantIds?: unknown;
  paymentApp?: unknown;
  paidAt?: unknown;
  locationName?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  notes?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

/** Maps the RPC's own exception text to the exact conflict copy the offline UI expects. */
function friendlyConflictMessage(raw: string): string {
  if (/does not exist or is not active/i.test(raw)) return "This trip is no longer available.";
  if (/payer is not an active member|participant must be an active member/i.test(raw)) {
    return "One or more members are no longer part of this trip.";
  }
  if (/not a member of this trip/i.test(raw)) return "This trip is no longer available.";
  if (/must be signed in/i.test(raw)) return "Please reconnect and sign in before syncing.";
  return raw;
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "The server isn't configured to sync expenses yet." },
      { status: 503 },
    );
  }

  const authClient = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Please reconnect and sign in before syncing." },
      { status: 401 },
    );
  }

  let body: SyncRequestBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const {
    idempotencyKey,
    tripId,
    paidByMemberId,
    amount,
    description,
    participantIds,
    paymentApp,
    paidAt,
    locationName,
    latitude,
    longitude,
    notes,
  } = body;

  if (typeof idempotencyKey !== "string" || !UUID_RE.test(idempotencyKey)) {
    return badRequest("A valid idempotency key is required.");
  }
  if (typeof tripId !== "string" || !UUID_RE.test(tripId)) {
    return badRequest("A valid trip is required.");
  }
  if (typeof paidByMemberId !== "string" || !UUID_RE.test(paidByMemberId)) {
    return badRequest("Choose who paid.");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return badRequest("Enter a valid amount.");
  }
  if (Math.round(amount * 100) / 100 !== amount) {
    return badRequest("Amount can have at most two decimal places.");
  }
  if (typeof description !== "string" || !description.trim()) {
    return badRequest("Add a short description.");
  }
  if (
    !Array.isArray(participantIds) ||
    participantIds.length === 0 ||
    !participantIds.every((id) => typeof id === "string" && UUID_RE.test(id))
  ) {
    return badRequest("Pick at least one person to split with.");
  }
  if (!isOptionalString(paymentApp)) {
    return badRequest("Invalid payment method.");
  }
  if (typeof paidAt !== "string" || Number.isNaN(Date.parse(paidAt))) {
    return badRequest("Invalid date.");
  }
  if (!isOptionalString(locationName)) {
    return badRequest("Invalid location.");
  }
  if (latitude !== undefined && latitude !== null) {
    if (typeof latitude !== "number" || latitude < -90 || latitude > 90) {
      return badRequest("Latitude must be between -90 and 90.");
    }
  }
  if (longitude !== undefined && longitude !== null) {
    if (typeof longitude !== "number" || longitude < -180 || longitude > 180) {
      return badRequest("Longitude must be between -180 and 180.");
    }
  }
  if (!isOptionalString(notes)) {
    return badRequest("Invalid notes.");
  }

  const { data, error } = await authClient.rpc("add_expense", {
    p_trip_id: tripId,
    p_paid_by: paidByMemberId,
    p_amount: amount,
    p_description: description,
    p_participant_ids: participantIds,
    p_payment_app: paymentApp ?? null,
    p_paid_at: paidAt,
    p_location_name: locationName ?? null,
    p_split_type: "equal",
    p_splits: null,
    p_category: null,
    p_notes: notes ?? null,
    p_latitude: latitude ?? null,
    p_longitude: longitude ?? null,
    p_offline_idempotency_key: idempotencyKey,
  });

  if (error) {
    console.error("Offline sync: add_expense RPC failed:", error);
    // add_expense()'s own `raise exception` messages are deliberately
    // human-facing (same trust boundary the online Add/Edit form already
    // relies on) — safe to relay, normalized to the offline UI's exact
    // conflict copy where one applies.
    return NextResponse.json({ error: friendlyConflictMessage(error.message) }, { status: 400 });
  }

  return NextResponse.json({ expenseId: data as string }, { status: 200 });
}
