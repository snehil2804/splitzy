import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addRecentLocation, getRecentLocations } from "../src/lib/recentLocations";
import type { LocationInput } from "../src/lib/types";

// Minimal in-memory localStorage polyfill for node:test (no DOM/jsdom in this project).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
(globalThis as unknown as { window: object }).window = globalThis;

function place(name: string, placeId: string | null = name): LocationInput {
  return { name, formattedAddress: `${name} address`, latitude: 1, longitude: 1, placeId };
}

beforeEach(() => {
  localStorage.clear();
});

test("a fresh device has no recent locations", () => {
  assert.deepEqual(getRecentLocations(), []);
});

test("adding a location makes it the most recent", () => {
  addRecentLocation(place("Blue Tokai Coffee"));
  const recents = getRecentLocations();
  assert.equal(recents.length, 1);
  assert.equal(recents[0].name, "Blue Tokai Coffee");
});

test("most recently added location comes first", () => {
  addRecentLocation(place("Blue Tokai Coffee"));
  addRecentLocation(place("Starbucks"));
  const recents = getRecentLocations();
  assert.deepEqual(
    recents.map((r) => r.name),
    ["Starbucks", "Blue Tokai Coffee"],
  );
});

test("re-adding the same place (by placeId) moves it to the front instead of duplicating", () => {
  addRecentLocation(place("Blue Tokai Coffee", "place-1"));
  addRecentLocation(place("Starbucks", "place-2"));
  addRecentLocation(place("Blue Tokai Coffee", "place-1"));
  const recents = getRecentLocations();
  assert.equal(recents.length, 2);
  assert.equal(recents[0].name, "Blue Tokai Coffee");
  assert.equal(recents[1].name, "Starbucks");
});

test("caps the list at 5 most recent, dropping the oldest", () => {
  for (let i = 1; i <= 7; i++) {
    addRecentLocation(place(`Place ${i}`, `place-${i}`));
  }
  const recents = getRecentLocations();
  assert.equal(recents.length, 5);
  assert.deepEqual(
    recents.map((r) => r.name),
    ["Place 7", "Place 6", "Place 5", "Place 4", "Place 3"],
  );
});

test("manually-typed locations (no placeId) are never saved as recents", () => {
  addRecentLocation({ name: "Some random spot", formattedAddress: null, latitude: null, longitude: null, placeId: null });
  assert.deepEqual(getRecentLocations(), []);
});
