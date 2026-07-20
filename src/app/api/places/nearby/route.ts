import { NextResponse } from "next/server";
import { isRateLimited } from "@/lib/server/rateLimit";
import { nearbySearchServer, PlacesApiError } from "@/lib/server/places-server";
import { getSupabaseAuthServer } from "@/lib/supabase-auth-server";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

interface NearbyRequestBody {
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
}

export async function POST(request: Request) {
  const authClient = await getSupabaseAuthServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (isRateLimited(`nearby:${user.id}`, 20)) {
    return NextResponse.json(
      { error: "Too many location requests — try again in a moment." },
      { status: 429 },
    );
  }

  let body: NearbyRequestBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const { latitude, longitude, radiusMeters } = body;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return badRequest("A valid latitude is required.");
  }
  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return badRequest("A valid longitude is required.");
  }
  let radius = 150;
  if (radiusMeters !== undefined) {
    if (typeof radiusMeters !== "number" || !Number.isFinite(radiusMeters)) {
      return badRequest("Invalid search radius.");
    }
    radius = Math.min(Math.max(radiusMeters, 10), 3000);
  }

  try {
    const places = await nearbySearchServer(latitude, longitude, radius);
    return NextResponse.json({ places });
  } catch (err) {
    if (err instanceof PlacesApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Unexpected nearby search error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't load nearby places." }, { status: 500 });
  }
}
