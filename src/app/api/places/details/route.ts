import { NextResponse } from "next/server";
import { isRateLimited } from "@/lib/server/rateLimit";
import { placeDetailsServer, PlacesApiError } from "@/lib/server/places-server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;
const SESSION_TOKEN_RE = /^[a-zA-Z0-9-]{8,100}$/;

interface DetailsRequestBody {
  placeId?: unknown;
  sessionToken?: unknown;
}

export async function POST(request: Request) {
  const authClient = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (isRateLimited(`details:${user.id}`, 20)) {
    return NextResponse.json({ error: "Too many requests — try again in a moment." }, { status: 429 });
  }

  let body: DetailsRequestBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const { placeId, sessionToken } = body;
  if (typeof placeId !== "string" || !PLACE_ID_RE.test(placeId)) {
    return badRequest("A valid place is required.");
  }
  if (
    sessionToken !== undefined &&
    (typeof sessionToken !== "string" || !SESSION_TOKEN_RE.test(sessionToken))
  ) {
    return badRequest("Invalid session token.");
  }

  try {
    const place = await placeDetailsServer(placeId, sessionToken);
    return NextResponse.json({ place });
  } catch (err) {
    if (err instanceof PlacesApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Unexpected place details error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't get details for that place." }, { status: 500 });
  }
}
