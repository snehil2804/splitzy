/** Visual identity for each trip member, keyed by lowercase name. */
export const MEMBER_STYLES: Record<
  string,
  { gradient: string; text: string; emoji: string }
> = {
  snehil: {
    gradient: "from-indigo-500 to-violet-500",
    text: "text-indigo-500",
    emoji: "🦊",
  },
  shruti: {
    gradient: "from-pink-500 to-rose-400",
    text: "text-pink-500",
    emoji: "🐰",
  },
  anshul: {
    gradient: "from-amber-500 to-orange-400",
    text: "text-amber-500",
    emoji: "🐻",
  },
};

export const FALLBACK_MEMBER_STYLE = {
  gradient: "from-slate-500 to-slate-400",
  text: "text-slate-500",
  emoji: "🙂",
};

export function memberStyle(name: string) {
  return MEMBER_STYLES[name.toLowerCase()] ?? FALLBACK_MEMBER_STYLE;
}

/** localStorage keys — all app storage is namespaced under `splitzy:`. */
export const STORAGE_KEYS = {
  theme: "splitzy:theme",
  identity: "splitzy:identity",
} as const;

export type ThemePreference = "system" | "light" | "dark";

/** Amounts within this many rupees are treated as settled. */
export const SETTLED_EPSILON = 1;
