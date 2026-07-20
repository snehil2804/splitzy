/**
 * Client-side Places helper. Calls only this app's own `/api/places/*`
 * Route Handlers — never Google directly, and never sees an API key.
 * The actual Places API key lives exclusively in
 * `src/lib/server/places-server.ts` (server-only, no `NEXT_PUBLIC_`
 * prefix).
 */

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

let configuredPromise: Promise<boolean> | null = null;

/**
 * Whether Smart Location is usable at all — checked once per page session
 * (via `/api/places/status`, which never calls Google) and cached, so
 * callers like the GPS auto-detect hook can skip requesting permission
 * entirely when there's nothing to resolve it to.
 */
export function checkPlacesConfigured(): Promise<boolean> {
  if (!configuredPromise) {
    configuredPromise = fetch("/api/places/status")
      .then((res) => (res.ok ? res.json() : { configured: false }))
      .then((data: { configured?: boolean }) => Boolean(data.configured))
      .catch(() => false);
  }
  return configuredPromise;
}

/** A fresh token for one autocomplete search session (keystrokes + the eventual details call). */
export function newSessionToken(): string {
  return crypto.randomUUID();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "That location request failed.");
  }
  return data as T;
}

/** Nearest recognizable places around a point, closest first. */
export async function nearbySearch(
  latitude: number,
  longitude: number,
  radiusMeters = 150,
): Promise<PlaceResult[]> {
  const data = await postJson<{ places: PlaceResult[] }>("/api/places/nearby", {
    latitude,
    longitude,
    radiusMeters,
  });
  return data.places;
}

/**
 * Resolves raw GPS coordinates to the nearest named place, for automatic
 * location detection. Widens the search radius once if nothing is found
 * close by (e.g. open countryside), so it still surfaces a locality-level
 * result rather than nothing. Returns null only if Places has genuinely
 * nothing nearby — callers should leave location empty in that case, never
 * show raw coordinates. This doubles as this app's "reverse geocoding" —
 * both calls go through `/api/places/nearby`, so no separate Geocoding API
 * product/route is needed.
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

/** Autocomplete predictions for free-text search, biased toward a location when known. */
export async function autocompletePlaces(
  query: string,
  sessionToken: string,
  bias?: { latitude: number; longitude: number },
): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];
  const data = await postJson<{ suggestions: PlaceSuggestion[] }>("/api/places/autocomplete", {
    query,
    sessionToken,
    ...(bias ? { latitude: bias.latitude, longitude: bias.longitude } : {}),
  });
  return data.suggestions;
}

/** Full details (incl. coordinates) for a place chosen from autocomplete or nearby results. */
export async function getPlaceDetails(placeId: string, sessionToken?: string): Promise<PlaceResult> {
  const data = await postJson<{ place: PlaceResult }>("/api/places/details", {
    placeId,
    sessionToken,
  });
  return data.place;
}
