/**
 * Server-only Google Places API (New) client. The API key never leaves
 * this process — the browser never calls Google directly; every location
 * request goes through the `/api/places/*` Route Handlers, which call
 * these functions with the server-only `GOOGLE_PLACES_API_KEY`. Same
 * "the secret never reaches client code" boundary as `supabase-server.ts`.
 * This file must never be imported from a `"use client"` module.
 */

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export const isPlacesConfiguredServer = Boolean(PLACES_API_KEY);

export interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
}

export interface PlaceSuggestion {
  placeId: string;
  text: string;
  secondaryText: string | null;
}

interface RawPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
}

function toPlaceResult(raw: RawPlace): PlaceResult | null {
  if (!raw.location) return null;
  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? raw.formattedAddress ?? "Unknown place",
    formattedAddress: raw.formattedAddress ?? null,
    latitude: raw.location.latitude,
    longitude: raw.location.longitude,
  };
}

/** Thrown with a message that's always safe to show the caller directly — never derived from raw upstream bodies. */
export class PlacesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PlacesApiError";
  }
}

const REQUEST_TIMEOUT_MS = 6000;

async function placesRequest<T>(
  path: string,
  init: Omit<RequestInit, "headers" | "signal"> & { fieldMask?: string },
): Promise<T> {
  if (!PLACES_API_KEY) {
    throw new PlacesApiError("Location search isn't configured.", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_API_KEY,
        ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}),
      },
    });

    if (!res.ok) {
      // Log only the upstream status + Google's own error message — never
      // the request headers (which is where the API key lives), never the
      // raw response body.
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      console.error(`Places API ${path} failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
      if (res.status === 429 || res.status === 403) {
        throw new PlacesApiError("Location search is temporarily unavailable — try again shortly.", 503);
      }
      throw new PlacesApiError("Couldn't complete that location search.", 502);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof PlacesApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new PlacesApiError("Location search timed out — try again.", 504);
    }
    console.error(`Places API ${path} request failed: ${err instanceof Error ? err.message : String(err)}`);
    throw new PlacesApiError("Couldn't complete that location search.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

// "Essentials"-tier fields only (id/name/address/location) — never rating,
// photos, reviews, etc., which bill at a higher SKU. Keep both masks as
// small as each endpoint allows.
const NEARBY_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";
const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";

/**
 * Nearest recognizable places around a point, closest first. Also doubles
 * as this app's "reverse geocoding" — resolving a raw GPS fix to a named
 * place is just a tight-then-wide nearby search (see
 * `resolveCurrentPlace()` client-side), so no separate Geocoding API
 * product/endpoint is needed.
 */
export async function nearbySearchServer(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<PlaceResult[]> {
  const data = await placesRequest<{ places?: RawPlace[] }>("places:searchNearby", {
    method: "POST",
    fieldMask: NEARBY_FIELD_MASK,
    body: JSON.stringify({
      maxResultCount: 10,
      rankPreference: "DISTANCE",
      locationRestriction: { circle: { center: { latitude, longitude }, radius: radiusMeters } },
    }),
  });
  return (data.places ?? []).map(toPlaceResult).filter((p): p is PlaceResult => p !== null);
}

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId: string;
      text?: { text: string };
      structuredFormat?: {
        mainText?: { text: string };
        secondaryText?: { text: string };
      };
    };
  }>;
}

export async function autocompleteServer(
  query: string,
  sessionToken: string,
  bias?: { latitude: number; longitude: number },
): Promise<PlaceSuggestion[]> {
  const data = await placesRequest<AutocompleteResponse>("places:autocomplete", {
    method: "POST",
    body: JSON.stringify({
      input: query,
      sessionToken,
      ...(bias ? { locationBias: { circle: { center: bias, radius: 20000 } } } : {}),
    }),
  });
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      placeId: p.placeId,
      text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondaryText: p.structuredFormat?.secondaryText?.text ?? null,
    }));
}

export async function placeDetailsServer(placeId: string, sessionToken?: string): Promise<PlaceResult> {
  const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
  const data = await placesRequest<RawPlace>(`places/${encodeURIComponent(placeId)}${query}`, {
    method: "GET",
    fieldMask: DETAILS_FIELD_MASK,
  });
  const result = toPlaceResult(data);
  if (!result) throw new PlacesApiError("That place has no location data.", 502);
  return result;
}
