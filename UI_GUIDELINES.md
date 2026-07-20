# UI Guidelines

Splitzy should feel like a **native iPhone app designed by a senior product team** on mobile, and a **mature desktop SaaS product** (Notion/Linear/Slack/GitHub/Revolut Web bar) at `md`+ — beautiful, minimal, playful, premium either way. Every screen delightful; every interaction intentional.

## Principles

1. **One-handed iPhone use.** Primary actions live in the bottom half; the tab bar is sticky with a raised center FAB, flush to the true screen edge (its own background absorbs the safe-area inset, never a floating pill with a gap beneath it). Tap targets ≥ 44 px. Pinch/double-tap zoom is disabled app-wide (`Viewport.maximumScale`/`userScalable` in `layout.tsx`) — this is a native-feeling app, not a zoomable document.
2. **Minimal cognitive load.** One idea per card. Numbers lead, labels follow. No clutter, generous spacing.
3. **Never a blank or ugly screen.** Loading = shimmer skeletons (never spinners). Empty = friendly emoji illustration + warm copy. Errors = human, helpful, retryable.
4. **Motion is seasoning.** Entrances use `anim-fade-up` with ≤ 45 ms stagger; sheets slide up with an ease-out spring curve on mobile (`.anim-dialog-in`, centers with a fade-scale-in at `md`+ instead); touches get `.tap` scale-down. Everything respects `prefers-reduced-motion`.
5. **Responsive, not two apps.** `TabBar` is mobile-exclusive (`md:hidden`); the persistent `Sidebar` (`src/components/Sidebar.tsx`) takes over at `md`+ — never both at once. Content width grows in capped steps (`md:max-w-3xl lg:max-w-4xl` on `<main>` in `layout.tsx`) so line length stays readable on ultrawide monitors rather than going edge-to-edge. Every interactive surface needs a `hover:` treatment for pointer users, gated `@media (hover: hover)` (or the `.glass-interactive` utility) when the effect would otherwise stick after a mobile tap. Every focusable element needs a visible `:focus-visible` ring (global, keyboard-only, defined once in `globals.css` — never override it away).

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
- **Members:** `<Avatar name=… />` — a name hashes to one of 6 gradient styles (indigo, pink, amber, emerald, sky, fuchsia) defined in `constants.ts`, so any trip's members get consistent, distinct colors with no per-person configuration.
- **Emoji:** every expense gets one via `expenseEmoji()`; section illustrations use a single large emoji in a `bg-brand-soft` rounded tile.

## Typography

Geist (via `next/font`). Page titles `text-2xl font-bold tracking-tight`; card headings `text-sm font-semibold text-ink-muted`; body `text-sm`; metadata `text-xs text-ink-muted`. Numbers always tabular.

## Dark mode

Both themes are first-class. Never hardcode grays/whites — use tokens so both themes stay correct. Theme choice (Auto/Light/Dark) lives in Settings; the inline script in `layout.tsx` prevents any flash.

## Copy voice

Warm, playful, Gen-Z-friendly, never corporate. "All settled up — nobody owes anything! 🎉", "That didn't work — it's probably the network, not you." Emoji are seasoning, not decoration on every line.
