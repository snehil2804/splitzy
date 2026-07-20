# Architecture

## Big picture

```
Apple Shortcut (planned)
        │
        ▼
Supabase Edge Function (planned) ─┐
        │                         │
        ▼                         ▼
PostgreSQL (this repo owns migrations — RLS, SECURITY DEFINER RPCs, trigger-based activity log)
        ▲                         ▲
        │  publishable key        │  secret key (server-only)
        │  authenticated reads    │  add_equal_expense() RPC (legacy, service_role-only)
        │  + most RPC writes      │
        ▼                         │
Next.js frontend — static shell   └── /api/expenses Route Handler
  + client-side reads/writes          ▲
  (RLS-scoped to trip membership)     │ fetch() (JSON, same-origin)
        │                             │
        ├── src/proxy.ts ── session refresh + route gate (every request)
        └── Add/Edit Expense form ────┘ (legacy name-based path only)
```

The backend (schema, RPCs, RLS, triggers) **lives in `supabase/migrations/` in this repo** — every schema change is an explicit, reviewed, additive migration, applied via the Supabase MCP tools and verified with before/after data snapshots. The frontend is a thin client over Supabase: almost every read and write goes straight from the browser to Postgres with the publishable key, protected entirely by row-level security and `SECURITY DEFINER` RPCs — not by anything the frontend enforces.

## Auth

Supabase Auth, cookie-based sessions (`@supabase/ssr`):

- **Sign-in**: Google OAuth (primary — works even inside the installed PWA) or a same-screen 8-digit email code (`verifyOtp`), chosen over tappable magic links because a link opens in a different browser context on iOS home-screen PWAs, stranding the session.
- **`src/proxy.ts`** (Next 16's renamed Middleware) runs on every request: refreshes the session cookie and redirects signed-out visitors to `/login`, except for an explicit public-path allow-list (`/login`, `/auth/callback`, `/join/[token]`).
- **`src/app/auth/callback/route.ts`** — server-only Route Handler completing the PKCE exchange (OAuth `?code=`) or a `token_hash` verification (emailed link), with friendly, stable error codes (never raw Supabase/PKCE jargon) via `src/lib/auth-errors.ts`.
- A `profiles` row is trigger-created per auth user; a `members` row (with `user_id` set) links an auth account to a trip identity. `members.user_id = null` means an unclaimed guest member — someone the trip owner added by name, invited later, with their history waiting to be claimed.

## Rendering model

Every page is a **Client Component behind a statically prerendered shell**:

- `next build` outputs almost every route as static HTML (`○` in the build summary) — first paint is instant and costs no server compute. This holds even for routes that read `useSearchParams()` (`/add`, `/login`) by wrapping the search-param-dependent part in a `<Suspense>` boundary.
- On hydration, `useTripData()` fetches from Supabase directly (publishable key, RLS-scoped) and the page transitions skeleton → content.
- Three routes are genuinely dynamic (`ƒ`, server-rendered on demand): `/api/expenses` (the one intentional server-only proxy — see below), `/auth/callback` (must run server-side to set the session cookie), and `/join/[token]` (reads the token from the URL).
- `/api/expenses` exists solely because the legacy `add_equal_expense()` RPC is `service_role`-only in production — the secret key that can call it must never reach the browser. Every other write, including the in-app Add/Edit Expense forms, calls `authenticated`-callable RPCs (`add_expense`, `edit_expense`, …) directly from the browser: RLS + `SECURITY DEFINER` already give the publishable key everything it needs, so no server hop is justified.

## Data layer (one-way doors avoided)

```
src/lib/
  supabase.ts              — browser client singleton (publishable key), cookie-based session
  supabase-server.ts       — server-only client (secret key); imported only by /api/expenses
  supabase-auth-server.ts  — server-only client (publishable key + cookies); used by proxy/callback
  supabase-middleware.ts   — session-refresh helper consumed by src/proxy.ts
  queries.ts               — THE ONLY FILE the UI calls into for data (fetch, add/edit/delete
                              expense, trip lifecycle, settlements, activity, invitations, profile)
  types.ts                 — DB row shapes + UI view models
  balances.ts              — pure balance/settlement math (no I/O, trivially testable)
  splitValidation.ts       — client-side split-math pre-check (mirrors, never replaces, the
                              database's own validation in compute_expense_splits())
  auth-errors.ts           — maps raw Supabase/PKCE errors to stable, human error codes
  errors.ts                — network vs. permission error classification
  format.ts                — INR currency, day/time formatting
  emoji.ts                 — expense emoji from category/description keywords
  constants.ts             — storage keys, thresholds (e.g. SETTLED_EPSILON)

src/app/api/expenses/route.ts — POST only; validates shape/range, then calls
  add_equal_expense() via supabase-server.ts. The only file besides
  supabase-server.ts that ever sees the secret key.
```

Design decisions worth knowing:

1. **Balances are computed client-side** in `balances.ts` from `expenses` + `expense_participants` + `settlements`, not from a DB balance function. This keeps the UI independent of RPC signatures and makes optimistic deletes exact (balances update instantly). `computeSettlements()` first partitions non-zero balances into independent zero-sum groups (exact backtracking search — trip sizes are small) before greedy-matching within each group, which is provably at least as good as, and sometimes strictly better than, plain greedy matching over the whole group.
2. **Split math lives in Postgres, once.** `compute_expense_splits()` is the single implementation for all four split types (equal/exact/percentage/shares) — `equal` is just `shares` with unit 1 for every participant — using the largest-remainder method so paise-rounded shares always sum exactly to the total. `splitValidation.ts` on the client mirrors this validation for fast feedback, but the database is always the authority.
3. **Column-name coupling lives in one file.** If the real schema differs, `queries.ts` (and `types.ts`) is the fix point — see SETUP.md for the current schema contract.
4. **Soft delete for expenses, hard delete for trips.** Expenses: `UPDATE expenses SET deleted_at = now(), deleted_by = <member id>, deletion_reason = ...`; reads filter `deleted_at IS NULL`. Trips: owner-only `delete_trip()` RPC does an atomic, FK-safe hard delete of the trip and everything under it — trips don't need history once gone.
5. **Activity logging is trigger-driven, not RPC-body-driven.** `activity_log` rows are written by `SECURITY DEFINER` triggers on `expenses`/`trip_members`/`invitations`/`settlements`, never by editing an existing RPC's body — this means already-tested RPCs (`create_trip`, `claim_invitation`, …) never had to change to gain activity logging. The trigger functions themselves are revoked from direct RPC-callability.
6. **RLS is the real access-control boundary, not the frontend.** Every table's reads are scoped to `is_trip_member(trip_id)`; almost every write is either a narrow column-level grant (soft-delete columns, trip name/description for owners, a user's own display name) or an `authenticated`-only `SECURITY DEFINER` RPC that re-validates membership, ownership, and business rules server-side. `anon` has zero access anywhere.

## State management

No state library. `src/hooks/useTripData.ts` is a ~120-line SWR-style store:

- module-level cache shared by all pages → tab switches render instantly from cache;
- keyed by the selected trip (`useSelectedTrip.ts`) — switching trips forces a fresh load;
- stale-after-30s background revalidation (cached data stays on screen);
- in-flight request deduplication;
- **optimistic delete** with rollback on failure;
- `useSyncExternalStore` for tear-free subscriptions and correct SSR snapshots.

`useSession.ts` mirrors the Supabase auth session the same way, for UI concerns only — `src/proxy.ts` is the actual access-control boundary, running before any of this ever renders. `useTheme.ts` follows the same pattern over `localStorage`, namespaced `splitzy:*`; theme is stamped on `<html data-theme>` by a blocking inline script in `layout.tsx` to avoid a flash of the wrong theme.

## Performance budget

- **Dependencies:** `@supabase/supabase-js` + `@supabase/ssr` — no icon/animation/state libraries. Icons are hand-rolled inline SVGs, animations are pure CSS, the animated counter is ~30 lines of rAF.
- **Almost every route is static** — the three dynamic exceptions (`/api/expenses`, `/auth/callback`, `/join/[token]`) are thin server-only handlers, not pages with server-rendered content. One Google font (Geist, self-hosted by `next/font`), no images.
- Skeletons (never spinners), `prefers-reduced-motion` respected globally.
- **No N+1 queries**: `fetchTripData()` loads members, expenses (+ participants), and settlements for the selected trip in one `Promise.all`; balance/settlement computation reuses that single fetch rather than re-querying per member.

## Folder structure

```
src/
  proxy.ts        Next 16's renamed Middleware — session refresh + route gate
  app/            routes: / (dashboard), /expenses, /balances, /settings,
                  /add (add + edit, via ?edit=<id>), /activity, /trips,
                  /login, /profile, /invitations, /join/[token]
                  + layout.tsx, globals.css, manifest.ts, icon.tsx, apple-icon.tsx
                  api/expenses/route.ts, auth/callback/route.ts — server-only
  components/     TabBar, ExpenseCard, SettlementList, ConfirmSheet, Avatar,
                  SplitFields, AnimatedNumber, Skeleton, StateViews, icons
  hooks/          useTripData, useSelectedTrip, useSession, useTheme
  lib/            data + domain layer (see above)
```
