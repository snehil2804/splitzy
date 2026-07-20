/**
 * Thin fetch-based wrapper around Google's Places API (New) REST
 * endpoints — no SDK/npm dependency, matching this project's
 * single-runtime-dependency architecture. Every request sends an explicit
 * field mask requesting only the cheapest ("Essentials"/"Pro" ID+location+
 * name tier) fields this app actually uses, never the full response, to
 * keep cost down. Autocomplete calls must be threaded through one shared
 * session token per search session (see `newSessionToken()`) — Google
 * bills a whole autocomplete-keystrokes-plus-final-details sequence as one
 * session when a token is reused, instead of billing every keystroke
 * separately.
 */

const PLACES_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

export const isPlacesConfigured = Boolean(PLACES_API_KEY);

export interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
}

export interface PlaceSuggestion {
  placeId: string;
  /** Primary label, e.g. "Blue Tokai Coffee". */
  text: string;
  /** Secondary label, e.g. "Select Citywalk, Saket, New Delhi". */
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

async function placesRequest<T>(
  path: string,
  init: Omit<RequestInit, "headers"> & { fieldMask?: string },
): Promise<T> {
  if (!PLACES_API_KEY) {
    throw new Error("Location search isn't configured yet.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": PLACES_API_KEY,
    ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}),
  };
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `Places API request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

/** A fresh token for one autocomplete search session (keystrokes + the eventual details call). */
export function newSessionToken(): string {
  return crypto.randomUUID();
}

const NEARBY_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location";

/** Nearest recognizable places around a point, closest first. */
export async function nearbySearch(
  latitude: number,
  longitude: number,
  radiusMeters = 150,
): Promise<PlaceResult[]> {
  const data = await placesRequest<{ places?: RawPlace[] }>("places:searchNearby", {
    method: "POST",
    fieldMask: NEARBY_FIELD_MASK,
    body: JSON.stringify({
      maxResultCount: 10,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: { center: { latitude, longitude }, radius: radiusMeters },
      },
    }),
  });
  return (data.places ?? []).map(toPlaceResult).filter((p): p is PlaceResult => p !== null);
}

/**
 * Resolves raw GPS coordinates to the nearest named place, for automatic
 * location detection. Widens the search radius once if nothing is found
 * close by (e.g. open countryside), so it still surfaces a locality-level
 * result rather than nothing. Returns null only if Places has genuinely
 * nothing nearby — callers should leave location empty in that case, never
 * show raw coordinates.
 */
export async function resolveCurrentPlace(
  latitude: number,
  longitude: number,
): Promise<PlaceResult | null> {
  const close = await nearbySearch(latitude, longitude, 100);
  if (close.length > 0) return close[0];
  const wider = await nearbySearch(latitude, longitude, 1500);
  return wider[0] ?? null;
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

/** Autocomplete predictions for free-text search, biased toward a location when known. */
export async function autocompletePlaces(
  query: string,
  sessionToken: string,
  bias?: { latitude: number; longitude: number },
): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];
  const data = await placesRequest<AutocompleteResponse>("places:autocomplete", {
    method: "POST",
    body: JSON.stringify({
      input: query,
      sessionToken,
      ...(bias
        ? { locationBias: { circle: { center: bias, radius: 20000 } } }
        : {}),
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

const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";

/** Full details (incl. coordinates) for a place chosen from autocomplete or nearby results. */
export async function getPlaceDetails(
  placeId: string,
  sessionToken?: string,
): Promise<PlaceResult> {
  const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
  const data = await placesRequest<RawPlace>(`places/${placeId}${query}`, {
    method: "GET",
    fieldMask: DETAILS_FIELD_MASK,
  });
  const result = toPlaceResult(data);
  if (!result) throw new Error("That place has no location data.");
  return result;
}
