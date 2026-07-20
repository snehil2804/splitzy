"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  autocompletePlaces,
  checkPlacesConfigured,
  getPlaceDetails,
  nearbySearch,
  newSessionToken,
  type PlaceResult,
  type PlaceSuggestion,
} from "@/lib/places";
import { addRecentLocation, getRecentLocations } from "@/lib/recentLocations";
import type { LocationInput } from "@/lib/types";
import { CrosshairIcon, MapPinIcon, SearchIcon, XIcon } from "./icons";

interface LocationPickerProps {
  onClose: () => void;
  onSelect: (location: LocationInput) => void;
  /** Already-resolved "here" place from auto-detection, shown as a pinned quick pick. */
  autoDetectedPlace: PlaceResult | null;
  /** Device coordinates, used to bias search + power the Nearby list. */
  coords: { latitude: number; longitude: number } | null;
}

function toLocationInput(place: PlaceResult): LocationInput {
  return {
    name: place.name,
    formattedAddress: place.formattedAddress,
    latitude: place.latitude,
    longitude: place.longitude,
    placeId: place.placeId,
  };
}

/**
 * Premium location picker: current location, nearby places, recent picks,
 * and search-as-you-type autocomplete — the user should find what they
 * want within one or two taps. Never renders raw coordinates.
 */
export function LocationPicker({
  onClose,
  onSelect,
  autoDetectedPlace,
  coords,
}: LocationPickerProps) {
  // This component is only ever mounted by the parent while the sheet
  // should be visible (`{pickerOpen && <LocationPicker ... />}`), so a
  // fresh mount *is* the reset — no effect needed to clear state on open.
  const [query, setQuery] = useState("");
  const [nearbyFetch, setNearbyFetch] = useState<{ key: string; places: PlaceResult[] } | null>(
    null,
  );
  const [searchFetch, setSearchFetch] = useState<{
    query: string;
    suggestions: PlaceSuggestion[];
  } | null>(null);
  const [recents] = useState<LocationInput[]>(() => getRecentLocations());
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = still checking (never shown as "not configured" during the
  // brief same-origin round trip), true/false once known.
  const [placesConfigured, setPlacesConfigured] = useState<boolean | null>(null);
  const sessionToken = useRef(newSessionToken());

  useEffect(() => {
    let cancelled = false;
    checkPlacesConfigured().then((configured) => {
      if (!cancelled) setPlacesConfigured(configured);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const coordsKey = coords ? `${coords.latitude},${coords.longitude}` : null;
  // No result recorded yet for the current coords/query = still in flight —
  // derived, not a separately-tracked "loading" flag. Never "loading" when
  // Places isn't configured at all, since no request is ever made.
  const loadingNearby =
    placesConfigured === true && coordsKey !== null && nearbyFetch?.key !== coordsKey;
  const nearby = nearbyFetch?.key === coordsKey ? nearbyFetch.places : [];

  const trimmedQuery = query.trim();
  const loadingSearch =
    placesConfigured === true && trimmedQuery !== "" && searchFetch?.query !== trimmedQuery;
  const suggestions = searchFetch?.query === trimmedQuery ? searchFetch.suggestions : [];

  useEffect(() => {
    if (!coords || !coordsKey || placesConfigured !== true) return;
    let cancelled = false;
    nearbySearch(coords.latitude, coords.longitude, 500)
      .then((places) => {
        if (!cancelled) setNearbyFetch({ key: coordsKey, places });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load nearby places.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coordsKey, not the coords object identity
  }, [coordsKey, placesConfigured]);

  useEffect(() => {
    if (!trimmedQuery || placesConfigured !== true) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      autocompletePlaces(trimmedQuery, sessionToken.current, coords ?? undefined)
        .then((results) => {
          if (!cancelled) setSearchFetch({ query: trimmedQuery, suggestions: results });
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Search isn't working right now.");
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coords only used to bias search, coordsKey is the real dep
  }, [trimmedQuery, coordsKey, placesConfigured]);

  function choose(location: LocationInput) {
    addRecentLocation(location);
    onSelect(location);
  }

  async function pickSuggestion(s: PlaceSuggestion) {
    setResolvingPlaceId(s.placeId);
    setError(null);
    try {
      const place = await getPlaceDetails(s.placeId, sessionToken.current);
      choose(toLocationInput(place));
      sessionToken.current = newSessionToken();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get details for that place.");
    } finally {
      setResolvingPlaceId(null);
    }
  }

  function pickManual() {
    const trimmed = query.trim();
    if (!trimmed) return;
    onSelect({ name: trimmed, formattedAddress: null, latitude: null, longitude: null, placeId: null });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a location"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="anim-fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div className="anim-sheet-up glass relative flex max-h-[85vh] w-full max-w-sm flex-col rounded-t-[2rem] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-lg font-semibold">Location</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap -m-1.5 rounded-full p-1.5 text-ink-faint"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="px-5 pt-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a place"
              maxLength={120}
              className="w-full rounded-2xl border-2 border-transparent bg-line/60 py-3 pl-10 pr-4 text-sm outline-none transition-colors focus:border-brand"
            />
          </div>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-5 pb-6">
          {placesConfigured === false && (
            <p className="mt-4 rounded-2xl bg-line/60 p-4 text-center text-sm text-ink-muted">
              Location search isn&apos;t set up yet — type a name below and it&apos;ll be saved as-is.
            </p>
          )}

          {error && (
            <p className="anim-fade-in mt-3 rounded-2xl bg-negative/10 p-3 text-center text-sm font-medium text-negative">
              {error}
            </p>
          )}

          {query.trim() ? (
            <div className="space-y-1">
              {loadingSearch && <p className="px-1 py-3 text-sm text-ink-faint">Searching…</p>}
              {!loadingSearch && suggestions.length === 0 && (
                <PlaceRow
                  icon={<MapPinIcon className="size-4" />}
                  name={`Use "${query.trim()}"`}
                  subtitle="No matching places — save this as typed"
                  onClick={pickManual}
                />
              )}
              {suggestions.map((s) => (
                <PlaceRow
                  key={s.placeId}
                  icon={<MapPinIcon className="size-4" />}
                  name={s.text}
                  subtitle={s.secondaryText}
                  onClick={() => pickSuggestion(s)}
                  busy={resolvingPlaceId === s.placeId}
                />
              ))}
            </div>
          ) : (
            <>
              {autoDetectedPlace && (
                <Section title="Current location">
                  <PlaceRow
                    icon={<CrosshairIcon className="size-4" />}
                    name={autoDetectedPlace.name}
                    subtitle={autoDetectedPlace.formattedAddress}
                    onClick={() => choose(toLocationInput(autoDetectedPlace))}
                  />
                </Section>
              )}

              {recents.length > 0 && (
                <Section title="Recent">
                  {recents.map((r) => (
                    <PlaceRow
                      key={r.placeId ?? r.name}
                      icon={<MapPinIcon className="size-4" />}
                      name={r.name}
                      subtitle={r.formattedAddress}
                      onClick={() => choose(r)}
                    />
                  ))}
                </Section>
              )}

              <Section title="Nearby">
                {loadingNearby && (
                  <p className="px-1 py-3 text-sm text-ink-faint">Finding nearby places…</p>
                )}
                {!loadingNearby && !coords && (
                  <p className="px-1 py-3 text-sm text-ink-faint">
                    Enable location to see nearby places, or search above.
                  </p>
                )}
                {!loadingNearby && coords && nearby.length === 0 && (
                  <p className="px-1 py-3 text-sm text-ink-faint">
                    Nothing found nearby — try searching.
                  </p>
                )}
                {nearby.map((place) => (
                  <PlaceRow
                    key={place.placeId}
                    icon={<MapPinIcon className="size-4" />}
                    name={place.name}
                    subtitle={place.formattedAddress}
                    onClick={() => choose(toLocationInput(place))}
                  />
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {title}
      </h3>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function PlaceRow({
  icon,
  name,
  subtitle,
  onClick,
  busy = false,
}: {
  icon: ReactNode;
  name: string;
  subtitle: string | null;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="tap flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-line/60 disabled:opacity-50"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        {subtitle && <span className="block truncate text-xs text-ink-muted">{subtitle}</span>}
      </span>
    </button>
  );
}
