/**
 * Deterministic visual identity for any member: the same name always hashes
 * to the same palette entry, with no per-person hardcoding.
 */
const MEMBER_PALETTE = [
  { gradient: "from-indigo-500 to-violet-500", text: "text-indigo-500" },
  { gradient: "from-pink-500 to-rose-400", text: "text-pink-500" },
  { gradient: "from-amber-500 to-orange-400", text: "text-amber-500" },
  { gradient: "from-emerald-500 to-teal-400", text: "text-emerald-500" },
  { gradient: "from-sky-500 to-cyan-400", text: "text-sky-500" },
  { gradient: "from-fuchsia-500 to-purple-400", text: "text-fuchsia-500" },
] as const;

export function memberStyle(name: string) {
  const key = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return MEMBER_PALETTE[hash % MEMBER_PALETTE.length];
}

/** localStorage keys — all app storage is namespaced under `splitzy:`. */
export const STORAGE_KEYS = {
  theme: "splitzy:theme",
  tripId: "splitzy:tripId",
} as const;

export type ThemePreference = "system" | "light" | "dark";

/** Amounts within this many rupees are treated as settled. */
export const SETTLED_EPSILON = 1;
