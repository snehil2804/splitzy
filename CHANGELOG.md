# Changelog

## [Unreleased] — Stage 2: authenticated multi-trip (branch `feature/auth-multi-trip`)

### Fixed — "Signups not allowed for otp" on the login page

Root cause: Stage 1's `shouldCreateUser: false` (invite-only) combined with an empty `auth.users` — every login attempt was a "new user" and GoTrue rejected it. Now `shouldCreateUser: true`: open signup is safe because RLS only reveals trips you're an active member of; a stranger who signs up sees an empty app.

### Database (4 migrations, all additive — verified zero changes to existing rows/IDs)

- `profiles` (auto-created by trigger on `auth.users` insert), `invitations` (owner-issued, optionally linked to an unclaimed guest member so accepting claims that identity + history)
- Added: `members.user_id` (null = guest), `trips.created_by`, `trip_members.role/is_active/left_at`, `expenses.created_by`
- Widened `expenses_valid_participant_count` from `1..3` to `>= 1` (any trip size)
- **RLS cutover**: all 6 `anon` policies dropped, `anon` grants revoked — anonymous users get nothing. New `authenticated` policies scope everything to active trip membership via `is_trip_member()` / `is_trip_owner()` (SECURITY DEFINER helpers). Writes restricted to column-scoped grants (soft-delete columns on `expenses`; `name/description/status/ended_at` on `trips` for owners; `display_name` on own profile) — everything else via RPC
- New RPCs (SECURITY DEFINER, `authenticated`-only EXECUTE): `create_trip`, `add_guest_member`, `invite_member`, `revoke_invitation`, `accept_my_invitations`, `set_trip_member_active`, `ensure_my_member`, and `add_expense` (ID-based, any trip size, cross-trip/participant validation, paise rounding copied from `add_equal_expense`)
- Verified by an automated end-to-end run with a disposable test user (15/15 checks: session, RLS isolation, anon lockout, owner role, guest members, split math, cross-trip rejection, column-grant enforcement, sign-out) — all test rows and the test user removed afterwards; baseline data re-verified intact

### App

- Multi-trip: trip switcher + create/rename/manage on new `/trips`; selected trip persisted per device (`splitzy:tripId`); `fetchTripData(tripId)` now reads members from `trip_members`
- Identity is the signed-in account: `useIdentity`/"Who are you?" removed everywhere; `myMemberId`/`myRole` derived from `members.user_id`; pending invitations auto-accepted after login
- New `/profile` (display name, linked member, sign out); Settings slimmed (profile + trips links, theme, about)
- Dashboard: "Total spent" → **Trip Total**; new You Paid / Your Share / Your Balance stat tiles
- Add Expense now calls `add_expense()` directly from the browser (RLS/definer-validated); `POST /api/expenses` kept for the future Shortcut path but now requires a session (401) and trip membership (403)
- Hardcoded members removed (avatar colors are name-hashed; no `DEFAULT_MEMBERS`)
- Responsive: `--tabbar-clearance` variable drives content padding + `scroll-padding-bottom`; tab bar uses `max(0.75rem, safe-area-inset-bottom)`; `interactiveWidget: resizes-content` so keyboards don't cover inputs; ≥44px touch targets on nav/list rows
- Proxy: `/api/*` passes through (routes answer 401 JSON themselves instead of a login redirect)

## [Stage 1] — 2026-07-19 — authentication (branch `feature/auth-multi-trip`)

### Added — Supabase SSR magic-link auth, not yet mergeable to `main`

- `@supabase/ssr` added as a dependency; `src/lib/supabase.ts` now uses `createBrowserClient` (cookie-based session) instead of `createClient` with `persistSession: false`
- `src/lib/supabase-auth-server.ts` (new): cookie-aware server client for Route Handlers/Server Components — distinct from the pre-existing service-role `supabase-server.ts`, which is untouched
- `src/lib/supabase-middleware.ts` + `src/proxy.ts` (new): Next.js 16's renamed Proxy convention refreshes the session via `getClaims()` on every matched request, redirects signed-out users to `/login`, and signed-in users away from `/login`
- `src/app/login/page.tsx` (new): magic-link sign-in form (`signInWithOtp`, `shouldCreateUser: false` — invite-only), with idle/sending/sent/error states; wrapped in `Suspense` for `useSearchParams`
- `src/app/auth/callback/route.ts` (new, `GET /auth/callback`): exchanges the PKCE `code` for a session, or relays Supabase's own `error_description` (expired/used link) back to `/login`; origin derived from the incoming request, no `NEXT_PUBLIC_APP_URL`
- `src/hooks/useSession.ts` (new): client-side session mirror (`onAuthStateChange`) for UI states — `proxy.ts` remains the actual access-control boundary
- `src/app/settings/page.tsx`: sign-out button + signed-in email, shown when authenticated
- `src/components/TabBar.tsx`: hidden on `/login`
- `src/components/icons.tsx`: added `MailIcon`

### Known, deliberately deferred to Stage 2 (not done in Stage 1)

- No RLS policies added for the `authenticated` Postgres role — reads will fail for signed-in users until Stage 2 applies them (only `anon` has SELECT policies today)
- `/api/expenses` still has no session check — out of Stage 1's approved scope, flagged for Stage 2
- No real users created in Supabase Auth yet; no production data or migrations touched

## [0.1.5] — 2026-07-19

### Verified — final production-readiness review, real credentials in place

- Real Supabase credentials pasted into `.env.local` (by the user, directly — no values displayed, logged, or read aloud at any point) and dev server restarted
- `npx tsc --noEmit` (no `typecheck` script exists in `package.json`, so ran the direct equivalent), `npm run lint`, `npm run build` — all clean; `/api/expenses` still builds dynamic (`ƒ`), everything else static (`○`)
- Confirmed no secret/service-role reference anywhere in client-reachable code: `SUPABASE_SECRET_KEY` exists only in `src/lib/supabase-server.ts`, whose only importer is the `/api/expenses` Route Handler; `grep` over the fresh `.next/static` build output found zero matches; a repo-wide sweep for `SUPABASE_SECRET_KEY`/`SERVICE_ROLE` outside `node_modules`/`.next` found nothing else; `next.config.ts` has no `env` passthrough
- Confirmed `.env.local` is still excluded from Git (`git check-ignore`, `git ls-files`)
- Re-confirmed the add-expense architecture is unchanged: browser → `POST /api/expenses` → server-side client → `add_equal_expense()`
- Re-confirmed soft delete still only ever sets `deleted_at`/`deleted_by`/`deletion_reason`, matching the column-level grant applied to production
- Ran a live, read-only spot check against the already-running local dev server: root page loads (200, no secret string in the HTML), and `POST /api/expenses` with a deliberately invalid body correctly returns 400 with a safe message, rejected before ever reaching Supabase (no DB write)
- No database policy or production data changes made this pass — none were needed
- **Result: READY FOR DEPLOYMENT.** Full interactive browser walkthrough of live data (dashboard/expenses/balances/add/delete) still recommended as a follow-up, not a blocker — see PROJECT_STATUS.md

## [0.1.4] — 2026-07-19

### Applied — RLS + column-privilege hardening executed against production

- Approved SQL from `PROJECT_STATUS.md` applied to production project `lbaxvltzzguebcaxopnk` via Supabase migration `anon_select_policies_and_expenses_softdelete_column_grant`: RLS `SELECT` policies for `anon` on `members`, `trips`, `trip_members`, `expenses`, `expense_participants`; an `anon` `UPDATE` RLS policy on `expenses`; the pre-existing blanket `anon` `UPDATE` grant on `expenses` revoked and replaced with a column-scoped `GRANT UPDATE (deleted_at, deleted_by, deletion_reason)`
- First attempt failed safely with `Cannot apply migration in read-only mode` — the connected Supabase MCP session was read-only; stopped immediately without retrying or working around it, per instruction to halt on any failure. Re-ran after the user re-authenticated the MCP connection with read-write access
- Verified all 6 policies exist exactly as specified (`pg_policies`); confirmed `has_column_privilege` is `true` for `deleted_at`/`deleted_by`/`deletion_reason` and `false` for all 11 business columns (`amount`, `paid_by`, `trip_id`, `description`, `payment_app`, `participant_count`, `share_per_person`, `paid_at`, `latitude`, `longitude`, `location_name`); confirmed `anon` still cannot `EXECUTE` `add_equal_expense()`
- Note: `has_table_privilege('anon','expenses','update')` reads `false` post-migration — differs from the pre-migration draft's assumption that it would read `true` since a column is updatable; the column-level checks remain the authoritative test and are all correct
- Ran a live read-only smoke test as the actual `anon` role (via `SET ROLE anon`, not just privilege introspection): found 1 active trip, 3 active members, 1 non-deleted expense, 3 expense participants — confirms `trips.status = 'active'` literal usage and that the RLS policies genuinely return real data, not just that grants exist. No rows created, updated, or deleted
- Updated PROJECT_STATUS.md to move this from "pending approval" to "applied & verified" with the full result set; no application code changed

## [0.1.3] — 2026-07-19

### Added — production integration (server-side write path)

- Discovered (read-only verification) that `add_equal_expense()` is `service_role`-only in production — neither `anon` nor `authenticated` has `EXECUTE` on it — so the browser can never call it directly with the publishable key
- `.env.local` created (placeholders only) at the repo root with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; `.env.local.example` updated to match
- `src/lib/supabase.ts` repointed at `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (was `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- Added `src/lib/supabase-server.ts`: a server-only Supabase client authenticated with `SUPABASE_SECRET_KEY`, imported only by the new API route
- Added `POST /api/expenses` (`src/app/api/expenses/route.ts`): validates the request (UUID trip id, payer required, amount > 0 with ≤ 2 decimals, description required, ≥ 1 participant, lat/lng ranges), then calls `add_equal_expense()` server-side; returns safe, generic error messages in production (the RPC's own `raise exception` messages are relayed as-is — they're human-facing by design) and logs unexpected errors server-side only
- `addEqualExpense()` in `queries.ts` now posts to `/api/expenses` instead of calling `supabase.rpc()` from the browser — the Manual Add Expense form's call site is unchanged
- Verified empirically (not just assumed) that the secret key never reaches the client bundle: grepped `.next/static` after `npm run build` for `SUPABASE_SECRET_KEY` and the placeholder string — zero matches; references exist only in `.next/server`
- Drafted (not applied) RLS policies for `anon` `SELECT` access on all 5 tables — production currently has RLS enabled with zero policies, so every anon-key read returns zero rows despite existing table-level grants
- Hardened the drafted `expenses` `UPDATE` access on request: replaced the initial row-only RLS policy (which left every column writable) with an RLS row policy **plus** a column-level `GRANT UPDATE (deleted_at, deleted_by, deletion_reason)`, after first `REVOKE`ing the pre-existing blanket table-level UPDATE grant on `expenses` (Postgres ACLs are additive, so the blanket grant had to go or it would've overridden the narrower one). Business columns (`amount`, `paid_by`, `trip_id`, `description`, `payment_app`, `participant_count`, `share_per_person`, `paid_at`, `latitude`, `longitude`, `location_name`) become unwritable by `anon` at the Postgres privilege level, not just by app convention — with no changes to `queries.ts` or app behavior, since `softDeleteExpense()` already only ever sends those 3 columns. Considered and documented trade-offs against a `BEFORE UPDATE` trigger and a `SECURITY DEFINER soft_delete_expense()` function (rejected for now — bigger changes than needed; noted as future hardening options)
- Full SQL + verification queries (including `has_column_privilege` checks) + security notes are in PROJECT_STATUS.md, still pending explicit approval before running
- Updated CLAUDE.md, SETUP.md, ARCHITECTURE.md, PROJECT_STATUS.md for the new env var names and the browser → API route → RPC write path

## [0.1.2] — 2026-07-19

### Added — Manual Add Expense form

- Verified the production Supabase project read-only: correct project, all 5 expected public tables, and the exact `add_equal_expense()` signature (`p_trip_id`, `p_paid_by_name`, `p_amount`, `p_description`, `p_participant_names`, `p_payment_app`, `p_paid_at`, `p_latitude`, `p_longitude`, `p_location_name` → returns `uuid`)
- `addEqualExpense()` in `queries.ts` now strictly typed via the new `AddEqualExpenseInput` view model (was `Record<string, unknown>`) and maps to the confirmed RPC argument names; returns the new expense id
- Built `/add` as a real form (was a "coming soon" placeholder): description, amount, payer (defaults to device identity), split with everyone or hand-picked members, optional payment app (quick chips + free text) and location
- Client-side validation only (description, amount, payer, at least one participant) — the equal split itself is still computed entirely by `add_equal_expense()`, never duplicated in TypeScript
- Loading/error/empty states reuse `Skeleton`, `ErrorState`, `EmptyState`, `SetupNotice`; success shows a gradient confirmation card, refreshes the shared `useTripData` cache (so dashboard/expenses/balances pick up the new expense), then navigates to Expenses
- Form matches the existing design system exactly (glass cards, `tap`, `anim-fade-up`, semantic tokens) — no new dependencies

## [0.1.1] — 2026-07-19

### Changed — database reconciliation (frontend aligned with the real Supabase schema)

- Expense date/time now comes from `paid_at` (was `created_at`); list ordering and day grouping follow it
- Active trip selected via `trips.status === 'active'` with newest-trip fallback (was: newest trip only)
- Member list filtered to `is_active = true`
- Location renamed to `location_name`; `latitude`/`longitude` typed but unused (future map); dropped the nonexistent generic `location` column
- `payment_app` displayed in expense cards ("Snehil paid via GPay")
- Soft delete now also records `deleted_by` (member id of the device identity, nullable) and `deletion_reason`
- Share resolution order: `expense_participants.share_amount` → `expenses.share_per_person` → equal split
- Removed the emoji category map (`expenses.category` does not exist); emoji is keyword-inferred from description
- Row types in `types.ts` now mirror the real schema of every queried table (audit/timestamp columns included; `trip_members` is intentionally not queried — see SETUP.md)
- Added `addEqualExpense()` RPC wrapper as the integration point for the Manual Add form (argument names pending the SQL definition)

## [0.1.0] — 2026-07-19

### Added

- Complete Phase 1 frontend: Dashboard, Expenses, Balances, Settings, Add-Expense placeholder
- Design system: Tailwind v4 semantic tokens, glassmorphism, gradient hero cards, light/dark themes with no-flash inline script
- Data layer: typed Supabase queries (`lib/queries.ts`), SWR-style shared cache (`useTripData`), optimistic soft delete with rollback
- Client-side balance & greedy settlement computation (`lib/balances.ts`)
- Expense emoji inference from category/description keywords
- Device identity ("who are you?") and theme preference stored in `localStorage`
- Skeleton loading, empty, error, and Supabase-not-configured states
- Sticky glass tab bar with raised Add FAB; safe-area-aware layout
- PWA scaffolding: web manifest, build-time-generated app icons, theme-color
- `.env.local.example`, documentation suite (README, CLAUDE, ARCHITECTURE, UI_GUIDELINES, SETUP, PROJECT_STATUS, ROADMAP)

### Removed

- All `create-next-app` starter boilerplate (template page, demo SVGs, default favicon)
