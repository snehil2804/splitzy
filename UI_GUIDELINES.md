# UI Guidelines

Splitzy should feel like a **native iPhone app designed by a senior product team** — beautiful, minimal, playful, premium. Every screen delightful; every interaction intentional.

## Principles

1. **One-handed iPhone use.** Primary actions live in the bottom half; the tab bar is sticky with a raised center FAB. Tap targets ≥ 44 px.
2. **Minimal cognitive load.** One idea per card. Numbers lead, labels follow. No clutter, generous spacing.
3. **Never a blank or ugly screen.** Loading = shimmer skeletons (never spinners). Empty = friendly emoji illustration + warm copy. Errors = human, helpful, retryable.
4. **Motion is seasoning.** Entrances use `anim-fade-up` with ≤ 45 ms stagger; sheets slide up with an ease-out spring curve; touches get `.tap` scale-down. Everything respects `prefers-reduced-motion`.

## Design tokens (source of truth: `src/app/globals.css`)

Semantic colors, themed via `data-theme` on `<html>` (light + dark defined for each):

| Token | Role |
| --- | --- |
| `canvas` | page background (soft lilac-tinted off-white / near-black) |
| `surface`, `surface-strong` | glass card fill / opaque surface |
| `ink`, `ink-muted`, `ink-faint` | text hierarchy (3 levels — don't invent more) |
| `line` | hairline borders, subtle fills |
| `brand`, `brand-soft`, `accent` | violet `#6c5bff` → pink `#ec4899` gradient family |
| `positive` / `negative` | money in / money out |

Use them as Tailwind colors: `text-ink-muted`, `bg-brand-soft`, `text-positive`, …

## Recipes

- **Glass card:** `glass rounded-3xl p-5` (blur + saturation + hairline border + soft shadow; adapts to theme).
- **Hero/gradient card:** `bg-gradient-to-br from-brand via-violet-500 to-accent` + a blurred white orb for depth.
- **Pressable:** add `tap` to anything clickable.
- **Money:** always `formatINR()` + `tabular-nums`. Positive nets green with `+`, negative red.
- **Members:** `<Avatar name=… />` — per-member gradients (Snehil indigo, Shruti pink, Anshul amber) defined in `constants.ts`.
- **Emoji:** every expense gets one via `expenseEmoji()`; section illustrations use a single large emoji in a `bg-brand-soft` rounded tile.

## Typography

Geist (via `next/font`). Page titles `text-2xl font-bold tracking-tight`; card headings `text-sm font-semibold text-ink-muted`; body `text-sm`; metadata `text-xs text-ink-muted`. Numbers always tabular.

## Dark mode

Both themes are first-class. Never hardcode grays/whites — use tokens so both themes stay correct. Theme choice (Auto/Light/Dark) lives in Settings; the inline script in `layout.tsx` prevents any flash.

## Copy voice

Warm, playful, Gen-Z-friendly, never corporate. "All settled up — nobody owes anything! 🎉", "That didn't work — it's probably the network, not you." Emoji are seasoning, not decoration on every line.
