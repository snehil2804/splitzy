import { NextResponse } from "next/server";
import { isRateLimited } from "@/lib/server/rateLimit";
import { autocompleteServer, PlacesApiError } from "@/lib/server/places-server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const SESSION_TOKEN_RE = /^[a-zA-Z0-9-]{8,100}$/;

interface AutocompleteRequestBody {
  query?: unknown;
  sessionToken?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

export async function POST(request: Request) {
  const authClient = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // Debounced client-side (300ms) so a fast typer sends far fewer than
  // this per minute in practice — generous enough for normal typing.
  if (isRateLimited(`autocomplete:${user.id}`, 40)) {
    return NextResponse.json({ error: "Too many searches — slow down a little." }, { status: 429 });
  }

  let body: AutocompleteRequestBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const { query, sessionToken, latitude, longitude } = body;
  if (typeof query !== "string" || !query.trim() || query.length > 200) {
    return badRequest("A search query is required.");
  }
  if (typeof sessionToken !== "string" || !SESSION_TOKEN_RE.test(sessionToken)) {
    return badRequest("Invalid session token.");
  }

  let bias: { latitude: number; longitude: number } | undefined;
  if (latitude !== undefined || longitude !== undefined) {
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return badRequest("Invalid location bias.");
    }
    bias = { latitude, longitude };
  }

  try {
    const suggestions = await autocompleteServer(query.trim(), sessionToken, bias);
    return NextResponse.json({ suggestions });
  } catch (err) {
    if (err instanceof PlacesApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Unexpected autocomplete error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Search isn't working right now." }, { status: 500 });
  }
}
