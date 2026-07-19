# Architecture

## Big picture

```
Apple Shortcut (planned)
        │
        ▼
Supabase Edge Function (planned) ─┐
        │                         │
        ▼                         ▼
PostgreSQL  (existing: tables, add_equal_expense() [service_role-only], balance functions)
        ▲                         ▲
        │  publishable key        │  secret key (server-only)
        │  read + soft-delete     │  add_equal_expense() RPC
        ▼                         │
Next.js frontend — static shell   └── /api/expenses Route Handler
  + client-side reads                  ▲
        │                              │ fetch() (JSON, same-origin)
        └── Manual Add Expense form ───┘
```

The backend (schema, RPCs, balance math in SQL) **already exists and is owned outside this repo**. The frontend treats Supabase as a read/soft-delete API for the publishable key, and never migrates or mutates schema.

## Rendering model

Every page is a **Client Component behind a statically prerendered shell**:

- `next build` outputs all routes as static HTML (`○` in the build summary) — first paint is instant and costs no server compute.
- On hydration, `useTripData()` fetches from Supabase directly (publishable key) and the page transitions skeleton → content.
- There is exactly **one API route**, `/api/expenses` (`ƒ`, server-rendered on demand) — it exists solely because `add_equal_expense()` is `service_role`-only in production; the secret key that can call it must never reach the browser. Every other read (and the soft-delete update) still goes straight from the browser to Supabase with the publishable key — no server hop, since that key is public by design.

## Data layer (one-way doors avoided)

```
src/lib/
  supabase.ts        — browser client singleton (publishable key) + isSupabaseConfigured flag
  supabase-server.ts — server-only client singleton (secret key); imported only by the API route
  queries.ts         — THE ONLY FILE the UI calls into for data (fetch, soft delete, add expense)
  types.ts           — DB row shapes + UI view models
  balances.ts        — pure balance/settlement math (no I/O, trivially testable)
  format.ts          — INR currency, day/time formatting
  emoji.ts           — expense emoji from category/description keywords
  constants.ts       — member styles, storage keys, thresholds

src/app/api/expenses/route.ts — POST only; validates shape/range, then calls
  add_equal_expense() via supabase-server.ts. The only file besides
  supabase-server.ts that ever sees the secret key.
```

Design decisions worth knowing:

1. **Balances are computed client-side** from `expenses + expense_participants`, not from the DB balance functions. This keeps the UI independent of RPC signatures, makes optimistic deletes exact (balances update instantly), and is trivially cheap for a three-person trip. The SQL functions remain the source of truth for the Shortcut/Edge-Function write path.
2. **Column-name coupling lives in one file.** If the real schema differs (e.g. soft-delete column name), `queries.ts` is the single fix point — see SETUP.md for the assumed schema.
3. **Soft delete only**: `UPDATE expenses SET deleted_at = now()`; reads filter `deleted_at IS NULL`.

## State management

No state library. `src/hooks/useTripData.ts` is a ~100-line SWR-style store:

- module-level cache shared by all pages → tab switches render instantly from cache;
- stale-after-30s background revalidation (cached data stays on screen);
- in-flight request deduplication;
- **optimistic delete** with rollback on failure;
- `useSyncExternalStore` for tear-free subscriptions and correct SSR snapshots.

Device-local preferences (`useIdentity`, `useTheme`) follow the same pattern over `localStorage`, namespaced `splitzy:*`. Theme is stamped on `<html data-theme>` by a blocking inline script in `layout.tsx` to avoid a flash of the wrong theme.

## Performance budget

- **Dependencies:** exactly one runtime dep (`@supabase/supabase-js`). Icons are hand-rolled inline SVGs; animations are pure CSS; the animated counter is ~30 lines of rAF.
- **All page routes static** (`/api/expenses` is the one intentional exception — it's a thin server-only proxy, not a page), one Google font (Geist, self-hosted by `next/font`), no images.
- Skeletons (never spinners), `prefers-reduced-motion` respected globally.

## Folder structure

```
src/
  app/            routes: / (dashboard), /expenses, /balances, /settings, /add
                  + layout.tsx, globals.css, manifest.ts, icon.tsx, apple-icon.tsx
  components/     presentational + small interactive pieces (TabBar, ExpenseCard,
                  ConfirmSheet, SettlementList, Avatar, Skeleton, StateViews, icons)
  hooks/          useTripData, useIdentity, useTheme
  lib/            data + domain layer (see above)
```
