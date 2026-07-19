import { NextResponse } from "next/server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase-server";

/**
 * Legacy name-based entry point for adding an expense, kept for the future
 * Apple Shortcut pipeline (the web app now calls the `add_expense()` RPC
 * directly). `add_equal_expense()` is service_role-only, so the call happens
 * here with the secret-key client — but only for a signed-in caller: the
 * session cookie is verified first, and membership of the target trip is
 * enforced before the privileged RPC runs.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AddExpenseRequestBody {
  tripId?: unknown;
  paidByName?: unknown;
  amount?: unknown;
  description?: unknown;
  participantNames?: unknown;
  paymentApp?: unknown;
  paidAt?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  locationName?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured) {
    return NextResponse.json(
      { error: "The server isn't configured to add expenses yet." },
      { status: 503 },
    );
  }

  const authClient = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: AddExpenseRequestBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const {
    tripId,
    paidByName,
    amount,
    description,
    participantNames,
    paymentApp,
    paidAt,
    latitude,
    longitude,
    locationName,
  } = body;

  if (typeof tripId !== "string" || !UUID_RE.test(tripId)) {
    return badRequest("A valid trip is required.");
  }
  if (typeof paidByName !== "string" || !paidByName.trim()) {
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
    !Array.isArray(participantNames) ||
    participantNames.length === 0 ||
    !participantNames.every((name) => typeof name === "string" && name.trim())
  ) {
    return badRequest("Pick at least one person to split with.");
  }
  if (!isOptionalString(paymentApp)) {
    return badRequest("Invalid payment app.");
  }
  if (typeof paidAt !== "string" || Number.isNaN(Date.parse(paidAt))) {
    return badRequest("Invalid date.");
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
  if (!isOptionalString(locationName)) {
    return badRequest("Invalid location.");
  }

  // Membership check through the caller's own RLS-scoped client: a trip the
  // user isn't an active member of is simply invisible to them.
  const { data: visibleTrip } = await authClient
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .maybeSingle();
  if (!visibleTrip) {
    return NextResponse.json(
      { error: "You are not a member of this trip." },
      { status: 403 },
    );
  }

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc("add_equal_expense", {
      p_trip_id: tripId,
      p_paid_by_name: paidByName,
      p_amount: amount,
      p_description: description,
      p_participant_names: participantNames,
      p_payment_app: paymentApp ?? null,
      p_paid_at: paidAt,
      p_latitude: latitude ?? null,
      p_longitude: longitude ?? null,
      p_location_name: locationName ?? null,
    });

    if (error) {
      console.error("add_equal_expense RPC failed:", error);
      // The function's own `raise exception` messages are human-facing by
      // design (e.g. "Payer is not an active member of this trip") — safe
      // to relay. Anything unexpected gets a generic message instead.
      const safeMessage =
        process.env.NODE_ENV === "production"
          ? "Couldn't add that expense. Please try again."
          : error.message;
      return NextResponse.json({ error: safeMessage }, { status: 400 });
    }

    return NextResponse.json({ expenseId: data as string }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error adding expense:", err);
    return NextResponse.json(
      { error: "Couldn't add that expense. Please try again." },
      { status: 500 },
    );
  }
}
