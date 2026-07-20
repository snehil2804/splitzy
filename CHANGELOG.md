# Changelog

## [Stage 4] — premium desktop UX refinement (`main` @ `1a87b56`)

Desktop-SaaS-quality pass (Notion/Linear/Slack/GitHub/Revolut Web bar) on top of the existing mobile-first design — mobile/PWA behavior below `md` is unchanged, colors/branding/business logic untouched.

- Root cause of every desktop shortcoming: zero responsive breakpoints anywhere in the codebase (a single fixed `max-w-md` column). `layout.tsx` now widens progressively at `md`/`lg`, capped for readable line length on ultrawide monitors
- New persistent desktop `Sidebar.tsx` (`md`+, hidden on mobile) — wordmark, prominent Add-expense action, full nav (previously `/trips`/`/activity`/`/profile` were multiple taps deep), account chip; reuses `useTripData()`/`useSession()`. `TabBar` is now the exclusive mobile pattern (`md:hidden`)
- Global `:focus-visible` ring (keyboard-only); new `useDialogA11y` hook (ESC-to-close, reference-counted scroll-lock so stacked dialogs — e.g. a delete confirmation opened from within the expense detail sheet — don't unlock each other prematurely, focus moved in/restored, Tab-trapped to the topmost dialog) applied to `ConfirmSheet`/`ExpenseDetailSheet`/`LocationPicker`, the latter two previously having neither ESC-to-close nor scroll-lock at all; confirmation dialogs default focus to the safe action, never the destructive one
- Dialogs dock to the bottom on mobile, center with a fade-scale-in at `md`+ instead of a bottom sheet stuck to a full desktop viewport
- Hover states added throughout (new `.glass-interactive` utility, hover-capable pointers only) on every clickable surface that lacked one; dashboard settlements + recent expenses sit side by side at `lg`; sticky day-group headers on Expenses; page-title heading scale bumped at `md`+
- Two fixes from a physical iPhone review of the preview: `TabBar` rewritten from a translucent floating pill (content visible through it, a visible gap below it) to a flush, ~95%-opaque, edge-to-edge bar whose own background absorbs the safe-area inset (`--tabbar-clearance` `6.5rem` → `5rem` to match); pinch/double-tap zoom disabled via `maximumScale`/`userScalable` on the Next.js `Viewport` export (confirmed in the built HTML's `<meta name="viewport">`, not a JS hack). Also swapped the "Paytm" payment-app suggestion for "Card"
- Verification: `lint`/`tsc --noEmit`/52-52 unit tests/`build` clean throughout; secret-key bundle grep clean. Interactive browser automation was unavailable all session, so this was verified via full diff review (catching one real bug: dialog initial focus defaulting to the destructive action) plus the user's own review of two rounds of Vercel Preview, including a physical-device pass

## [Expense Details] — click-to-preview + creator-only edit permissions (`main` @ `5000bed`)

Clicking any expense (whole card, keyboard-accessible) opens a bottom-sheet preview showing exactly what was saved, with "Paid by" (the trip-member payer) and "Logged by" (the authenticated creator) always shown as distinct sections — never conflated. Full split breakdown, payment app, location (name + formatted address, lat/lng only in a collapsible "Technical details" section alongside the expense ID and created/updated timestamps), and trip name. Query-param-driven (`?view=<id>`) so the browser back button closes it correctly.

- Migration `20260721120000_expense_creator_only_edit` (additive, signature-unchanged so grants were untouched): tightens `edit_expense()`'s permission check from creator-or-owner to **creator-only** — closes the gap where the trip owner could modify another member's expense wording/amount, not just remove it
- New permission model, one shared `getExpensePermissions()` helper (`src/lib/expensePermissions.ts`) used by the expense list, the detail sheet, and the Add/Edit page's edit guard: **Edit** = creator only, never the owner, never a legacy row. **Delete** = creator OR trip owner — the owner's delete right is moderation/cleanup only and never implies edit access. Legacy expenses (`created_by IS NULL`, predating Stage 3's creator tracking) can never be edited by anyone; only the trip owner may delete them. Enforced identically server-side: `edit_expense()`'s own check for edit, the existing `expenses_update_owner_or_creator` RLS policy (already creator-or-owner) for delete — never just hidden buttons. A non-creator trip owner sees a specific explanatory note ("you can remove it, but you didn't log it, so you can't edit its contents" for a known creator; a legacy-specific variant when `created_by` is null); ordinary members see neither button plus a generic note
- Fixed a real pre-existing gap while wiring this in: the expense list's Delete button was previously always shown regardless of permission, with no server-side-matching gate
- Tests: +9 unit (`tests/expensePermissions.test.ts`, all creator/owner/legacy/signed-out combinations) — 52/52 total; live suite `npm run test:trip-expense-engine` updated and extended for the new creator-only-edit rule plus two new legacy-expense-specific checks (owner can delete but not edit a `created_by = null` row) — 42/42

## [Stage 3] — trip lifecycle, expense splits, balances & settlements — merged & live (`main` @ `3d43c6e`)

The financial engine: 4 expense split methods, creator-or-owner permissions, trip lifecycle management, optimized settlements, and an activity feed.

- Migration `20260721100000_trip_expense_engine` (additive) + `…103000_…hardening` follow-up: `expenses` gains `split_type`/`category`/`notes`/`currency`; `expense_participants` gains `share_percentage`/`share_units`; new `settlements` and `activity_log` tables (RLS: `authenticated` SELECT-only, scoped to trip membership)
- New shared `compute_expense_splits()` Postgres function: equal/exact/percentage/shares all funnel through one largest-remainder-method implementation (equal = shares with unit 1 for everyone) rather than four separate algorithms — used by both `add_expense()` (extended with `p_split_type`/`p_splits`/`p_category`/`p_notes`, backward compatible) and the new `edit_expense()`
- `edit_expense()` + a tightened `expenses` UPDATE RLS policy: only the expense's creator or the trip owner may edit or delete it — closes a gap where any trip member could soft-delete anyone else's expense
- New owner-only `delete_trip()` (atomic hard delete of the trip and everything under it, FK-safe order), `leave_trip()` (blocked for a sole owner — must transfer ownership first), `transfer_trip_ownership()`; member-callable `record_settlement()`
- Activity logging added entirely via `SECURITY DEFINER` triggers on `expenses`/`trip_members`/`invitations`/`settlements`, deliberately *not* by editing those tables' own already-tested RPC bodies; the trigger functions are revoked from direct RPC-callability (same hardening pattern as `handle_new_user()`)
- `computeSettlements()` in `balances.ts` now partitions non-zero balances into independent zero-sum groups (exact backtracking search) before greedy-matching within each group, instead of greedy-matching the whole group at once — strictly at least as good, sometimes fewer transactions (see the new unit test for a worked example: 3 transactions instead of naive greedy's 4)
- Frontend: `SplitFields` component (split-method selector + per-participant inputs, shared by Add and Edit) and `splitValidation.ts` (client-side pre-check mirroring the DB's validation); Add Expense page now also handles Edit via `?edit=<id>`, reusing every field; Expenses page shows an edit affordance only when the signed-in member may use it; Trips page gained trip description editing, transfer ownership, leave trip, and a typed-confirmation delete-trip flow; Balances page gained "You owe / You are owed / Net balance" tiles and a "mark as paid" action per suggested settlement; new `/activity` page (immutable feed, linked from the Trips page header)
- Fixed two pre-existing bugs surfaced while wiring this in: `computeBalances()` was called without its `settlements` argument on both the dashboard and Balances page, so recorded settlements never adjusted the balances shown
- Tests: +11 unit (split-validation edge cases for all 4 methods; a settlement-optimization case proving the zero-sum-partition pass beats naive greedy; balance adjustment from a recorded settlement) — 31/31 total; new live suite `npm run test:trip-expense-engine` (38/38): split math for all 4 methods incl. validation rejections, creator/owner edit+delete permissions, settlement recording + RLS, activity log entries + RLS + direct-RPC-call rejection, trip description/transfer/leave/delete permissions and effects, full RLS isolation for a non-member. Pre-existing `test:db`/`test:auth`/`test:invitations` re-run clean, no regressions

## [Unreleased] — Invitations inbox: accept/decline without the link (branch `feature/invitations`)

Existing accounts no longer have to open the invite link to join — a new `/invitations` page (linked from Settings, with a pending-count badge) lists every pending invite addressed to the signed-in user's own email, with Accept/Decline. Reuses the existing architecture unchanged: Accept calls the same `claim_invitation()` RPC the link flow already uses (no new claim logic); Decline is a new, narrowly-scoped RPC that only ever flips this one invitation's own status — it never touches the target member or trip.

- Migration `20260720140000_invitations_inbox` (additive): widens `invitations.status` to allow `'declined'`; adds `list_my_invitations()` (SECURITY DEFINER, `authenticated`-only, returns trip/member/inviter names + the token, scoped to `lower(email) = caller's verified JWT email` — the exact ownership proof `preview_invitation()` already uses for anonymous link visitors) and `decline_invitation()` (same email-match scoping, `status='pending' → 'declined'` only)
- Users without an account are unaffected — they still only ever see the link flow (`/join/[token]`), since `list_my_invitations()` requires a session
- Tests: +2 unit (`formatDate`, new shared date-display helper); live suite (`npm run test:invitations`) now 24/24 — added: invite surfaces in the intended account's inbox with correct trip/member/inviter/token, never in another account's inbox, decline is self-only (a different account can't decline someone else's invite), decline never touches the member/trip, a declined invite disappears from the pending list and its link can no longer be claimed

## [Fix] — invite claim race with matching email

**Root cause**: `useSession.ts` auto-fired the legacy `accept_my_invitations()` (email-matched auto-claim) on *every* login, racing `/join/[token]`'s explicit `claim_invitation()` whenever an invite carried an email matching the signer's own — both targeted the same row on the same sign-in event. Confirmed in the DB: the affected invitation showed `status: 'accepted'`, `accepted_by: null` — proof the background path (which never sets `accepted_by`) won the race, correctly linked the member, then `/join` found a non-pending row and showed "invite expired/revoked" even though the user was already correctly joined. No data corruption at any point — purely a confusing UI outcome from two correct mechanisms competing.

**Fix** (3 files, no SQL/RLS changes): removed the automatic background call in `useSession.ts` — `claim_invitation()` via the link is now the single source of truth for claiming. Fixed the invite form's email-field placeholder, which claimed the email "restricts who can claim it" (never true — `claim_invitation` was always token-only by design) to reflect its actual purpose (owner's own record-keeping). Added a regression case to `npm run test:invitations` (now 16/16) that simulates the old race at the DB level and proves it now fails cleanly with no corruption.

## [Invitations] — shareable invite links (branch `feature/invitations`)

Shareable invite links replace the email-only auto-claim flow (kept as an optional secondary path). Migration `20260720120000_invitation_tokens`, additive — 1 pre-existing (already-revoked) invitation row backfilled a token via column default, no other data touched.

- `invitations` gains `token` (unique, 24-byte hex, `pgcrypto`), `expires_at` (7-day default), `accepted_by`; `email` becomes nullable (token is now the primary claim mechanism, email is an optional secondary auto-claim-on-login restriction)
- `invite_member()`: now member-first (`p_member_id` required — a UUID is always the target, never a name/email), returns the token instead of the invitation id
- New `preview_invitation(token)`: **the one deliberate `anon` grant** — lets a link recipient see "Join {trip} as {member}" before signing in; returns only names + a validity flag, nothing else, and only for a token the caller already possesses
- New `claim_invitation(token)`: `authenticated`-only, the token is the sole credential (no email match needed). Guards: pending + unexpired; target member still unclaimed; caller not already linked to a *different* member (`members.user_id` is globally unique — one account, one identity, ever); claim + trip join happen atomically. Verified live (13/13, `npm run test:invitations`): token required, anon preview works, anon claim rejected, single-use (replay rejected), expiry enforced, cross-member-lock enforced, no email gate on the token itself, non-member RLS isolation holds
- New `/join/[token]` page (public — added to proxy's allow-list): preview → "Continue to sign in" (`/login?next=/join/token`) → auto-claims once authenticated → redirects into the trip
- Trips page: "Invite by email" replaced with a combined **Invite someone** flow — toggle existing unclaimed guest vs. create a new one inline, optional email restriction, then **Copy Link**, **WhatsApp**, and native **Share** (feature-detected) on the generated link; pending-invitations list shows member name, expired badge, and a per-invite copy-link action
- Tests: +3 unit (link/WhatsApp URL shaping) — 18/18 total; `npm run test:invitations` new live suite

## [Auth Phase 1] — Google + email OTP

### Root cause fixed: "PKCE code verifier not found in storage"

PKCE magic links store their code verifier in a cookie in the browser that *requested* the link; on iOS home-screen PWAs (and cross-device), the emailed link opens in a different browser context with no verifier, so the exchange failed — and the raw error was rendered to the user.

- **New login page**: "Continue with Google" (primary; OAuth stays in the same context, so it works in the installed PWA), divider, then email → same-screen **verification code** entry (`verifyOtp(email, token)`, no callback context needed). Resend with 30s cooldown, change-email, paste/`one-time-code` autocomplete, loading states, double-submit guards. This project issues **8-digit** codes (verified live) — input accepts 6–8.
- **Callback rewritten** (`/auth/callback`): handles OAuth/PKCE `?code=`, plus `?token_hash=&type=` server-side verification — the emailed link becomes cross-context-safe once the email template is updated (manual step, see PROJECT_STATUS). Raw errors are logged server-side only; users get stable friendly codes via `src/lib/auth-errors.ts` (never "PKCE"/"verifier"). **Open-redirect fixed**: `next` is validated to same-origin absolute paths (`//evil.com`, absolute URLs, backslashes → `/`).
- **Duplicate-identity audit**: exactly one auth user (email provider), one profile, one linked member (Snehil) — no duplicates. Google sign-in with the same verified email is expected to link to the existing user automatically (Supabase default); profiles key on user id, so no duplicate profile/member is possible app-side.
- **Tests**: +7 unit (error classification, no-jargon copy guard, open-redirect matrix) and `npm run test:auth` — 6/6 live checks: single profile on signup, real 8-digit OTP verify, reused/wrong code rejected, `token_hash` verify with no verifier present.

## [Unreleased] — Stage 3: forensics + completion (branch `feature/auth-multi-trip`)

- **Diagnosed the "Anshul / permission denied / network error" report**: the user was on production (`main`, pre-auth build), which broke by design when the RLS cutover removed anon access, and which greets from the legacy localStorage identity. The feature branch was already correct; production heals on merge.
- Legacy `splitzy:identity` localStorage key now deleted on first load (pre-paint script) so the old picker value can never resurface.
- Settings → About shows the deployed build hash (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`) for deployment diagnosis.
- Honest error copy: network-specific message only for real fetch failures; generic copy otherwise; raw DB error text shown in development only (logged to console in production).
- Trips: archive/reactivate with confirmation sheet; remove-member confirmation sheet; owner role management ("Make owner"/"Make member") via new `set_trip_member_role` RPC (migration `20260719163000`, blocks demoting the last active owner); Add Expense shows a read-only notice for archived trips.
- `ConfirmSheet` gained configurable busy/cancel labels.
- Tests: `npm test` (tsx + node:test — balance math incl. ₹900 → +600/−300/−300, settlements, partial splits, error classification) and `npm run test:db` (17-check live e2e with self-cleaning sandbox); `npm run typecheck` script added.

## [Stage 2] — authenticated multi-trip (branch `feature/auth-multi-trip`)

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
