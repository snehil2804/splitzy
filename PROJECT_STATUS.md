# Project Status

_Last updated: 2026-07-21 (settlement UPI payments — merged and live)_

## ✅ Settlement UPI payments — MERGED AND LIVE

Fixes the settlement-row mobile layout and adds a "Pay via UPI" flow — see CHANGELOG "[Settlement UPI payments]" for the full change list. Two additive migrations applied to production: `20260722000000_member_upi_id.sql` (`members.upi_id`, format CHECK, column-scoped self-service grant + RLS policy mirroring `profiles.display_name`) and `20260722010000_fix_member_upi_id_regex_limit.sql` (the `{2,256}` → `{2,100}` regex-limit fix). Settlement math/`record_settlement()`/balance calculations untouched.

**Verification**: `lint`/`tsc --noEmit`/91-91 unit tests (was 74, +17 new UPI cases)/production build all clean; offline-bundle regression re-run (`/offline` still 730 KB/12 assets, `GoTrueClient` still absent); the stale three-friend branding confirmed gone from the built HTML and manifest. The real verification was the user's own physical-iPhone testing across four Preview rounds, which caught two things nothing local would have: the regex-limit bug (every UPI save failing) and the iOS single-app deep-link behavior.

**Two lessons worth keeping**:
1. **Verifying a constraint exists is not verifying it works.** The `{2,256}` regex bug passed a "does the constraint exist / does the pattern match in JS" check and still failed every real write, because PostgreSQL's regex engine caps bounded repetition at 255 and JS doesn't. Always push a real value through a new constraint before calling it verified.
2. **iOS has no chooser for custom URL schemes.** When several apps register `upi://`, Apple's docs say the chosen app "is undefined" — so a generic UPI link silently opens one arbitrary app forever. Targeting a specific app reliably needs that provider's merchant registration; the best-effort branded schemes shipped here are labeled as such and never the only path.

**Interactive browser verification was again unavailable** (Chrome extension unresponsive across several attempts this session), so layout changes were verified by build/tests/measurement plus static markup reproductions sent to the user — the physical-device pass remains the real check.

## ✅ Production data reset — DONE

The database now holds exactly one real member (`Snehil`, linked to `snehilrai678.sr@gmail.com`) plus 4 preserved-for-reuse guest identities (`Shruti`, `Anshul`, `Heteee`, `Snehiltest`) and zero trips/expenses/settlements/invitations/activity — a clean slate for real usage. Full detail in CHANGELOG "[Data cleanup]". Schema, RLS, functions, triggers, and auth configuration are all untouched; the real login was verified to still be the sole row in both `auth.users` and its linked `members`/`profiles` rows after cleanup.

**Before → after row counts:**

| Table | Before | After |
|---|---|---|
| `trips` | 9 | 0 |
| `expenses` | 14 | 0 |
| `expense_participants` | 47 | 0 |
| `trip_members` | 5 | 0 |
| `invitations` | 2 | 0 |
| `settlements` | 1 | 0 |
| `activity_log` | 62 | 0 |
| `members` | 30 | 5 |
| `profiles` | 16 | 1 |
| `auth.users` | 16 | 1 |

**Verification after cleanup**: all 16 RPCs/helper functions still present; security advisors unchanged (only pre-existing by-design warnings); `lint`/`tsc --noEmit`/74-74 unit tests/production build all clean. **Not yet done**: a live UI walkthrough (sign in, confirm Trips/Expenses/Balances show empty states, create a new trip, invite a member, add/edit/delete an expense) — recommended as the next manual check now that real usage is starting.

## ✅ Offline Expense Queue — MERGED AND LIVE

Record expenses with no signal (the mountain-trip case); they queue on the device and sync when the connection returns. Built on `feature/offline-expense-queue` across five checkpoints, reviewed on Vercel Previews throughout, and merged only after the user verified offline capture and sync on a physical device with WiFi and cellular both off. See CHANGELOG "[Offline Expense Queue]" for the full change list.

**Architecture**: dedicated Offline Mode at `/offline` + `/offline/add` (never a degraded copy of the live app — balances, settlements, and activity are simply not shown offline rather than shown stale); IndexedDB via `idb` for the queue and cached trip/member reference data; a hand-rolled service worker for the app shell; and `POST /api/expenses/sync` wrapping the existing `add_expense()` RPC with a database-enforced idempotency key.

**Migration** `20260721130000_offline_expense_idempotency` (additive, applied with explicit approval): `expenses.offline_idempotency_key` + a partial unique index scoped per-creator, and a trailing defaulted parameter on `add_expense()` that returns the existing row on replay. Online expense creation is provably unaffected — 42/42 of the pre-existing live engine suite re-passed unmodified.

**Three real bugs found and fixed during rollout, all worth remembering:**
1. *`CREATE OR REPLACE FUNCTION` does not replace a function whose signature changed.* Appending even a defaulted parameter makes Postgres create a **second overload**, and the new function object inherits the schema's default grants — which on this project include `anon`. Never an exploit (the function still checks `auth.uid()` internally) but wrong; fixed live and the migration now documents the drop-and-recreate-plus-regrant sequence.
2. *Caching an offline route's HTML is not enough to make it work.* These are client components whose server-rendered HTML **is** the "Loading…" placeholder — verified directly against a production build. Without their JS chunks also cached there is nothing to hydrate with and no network to fetch from, so the page loads and sits on "Loading…" permanently. This is what the user hit on-device. The worker now scrapes and precaches those chunks at install.
3. *`/offline` was auth-gated*, so it answered `307 → /login`, and `cache.put()` throws outright on a redirected response — meaning precaching failed **completely and silently** whenever the worker installed before sign-in. Now a public path, which costs nothing: it renders no server data, reads only per-user-scoped IndexedDB, and gates its own contents on identity.

**Performance**: measured rather than guessed, in three passes. `/offline` originally shipped ~1009 kB of uncompressed JS, of which ~256 kB was the Supabase auth SDK sitting on the critical path purely for a `getSession()` call that cannot succeed offline. First the two zero-risk wins — collapsed identity + reference data from two sequential IndexedDB scans into one, and dropped the ~600 ms of entrance animation on the offline screens only. Then the SDK itself was evicted: **`/offline` is now 730 kB across 12 assets (−280 kB, −28%), with the Supabase SDK verified absent from every chunk it loads** (checked against the deployed production site, not just locally). `/login` still carries it, as it must.

Two things made the eviction possible: `useOfflineBootstrap` now reads an `active_user_id` marker from IndexedDB — written by the online app on every session change, cleared explicitly in `signOut()` — rather than calling `useSession()`; and the Supabase-dependent shell components (`Sidebar`, `OfflineCacheWarmer`, `AutoSyncTrigger`) were grouped into `OnlineShell`, loaded via `ShellGate`, which renders nothing on `/offline*` so that chunk is never requested there. Server rendering was deliberately left enabled on the gate, so the desktop sidebar is still in the initial HTML and there is no layout shift — verified by fetching the dashboard with a real session cookie and confirming `<aside>` plus its nav labels are in the server-rendered markup. `useAutoSync` was made SDK-free in the process (it takes `userId` as an argument instead of reading the session), so the offline screen keeps the full trigger set — `online` event, foreground return, post-sign-in — rather than silently losing the visibility trigger.

**Verification**: lint, typecheck, 74/74 unit tests, production build, and secret-key bundle scan clean; 102 live e2e checks green across six suites (18 db, 42 trip-expense-engine, 6 auth, 24 invitations, 6 offline-idempotency, 6 offline-conflicts); precache mechanism verified end-to-end against a running production build (17/17 files cacheable); and an on-device offline capture + sync pass by the user.

**A fourth bug, caught by the post-deploy smoke check rather than by testing**: `/sw.js` answered `307`. The proxy matcher excludes the generated favicon/icon/manifest routes but not `sw.js`, so the service worker script was treated as a gated page — a signed-out request for it redirected to `/login`, and a redirect to an HTML document is not a loadable worker script, so registration failed outright and that device got **no offline shell whatsoever**. It never surfaced in testing because registration normally happens on a page load while already signed in, where the session cookie let it through; a first visit before sign-in silently got nothing. Excluded from the matcher and verified serving `200 application/javascript`.

**Known limitations**: Background Sync API is deliberately unused (foreground triggers only — it is not dependable on iOS/Safari); service worker cache-busting is a hardcoded version string rather than build-hash-driven, which is fine at this scope but would need revisiting if the shell grows. Interactive browser verification of the *post-eviction* offline reload has not been done — the browser-automation tooling was unavailable through that work, so it was verified by measurement (production bundle analysis, SSR probe with a real session cookie, precache check) rather than by clicking through it.

_Previous entry below._

## ✅ Stage 4: premium desktop UX refinement — MERGED AND LIVE

Full UX audit against a desktop-SaaS quality bar (Notion/Linear/Slack/GitHub/Revolut Web), then a prioritized implementation pass. Mobile/PWA behavior below the `md` breakpoint is unchanged; colors, branding, and all business logic (auth, balances, settlements, expense logic, smart location, permissions, invitations, schema) untouched.

**Critical**: the entire app had zero responsive breakpoints anywhere (confirmed via grep) — a single fixed `max-w-md` column on every viewport. `layout.tsx` now widens progressively at `md`/`lg`, capped so line length stays readable on ultrawide monitors. New persistent desktop `Sidebar` (hidden on mobile; `TabBar` is now the exclusive mobile pattern, hidden at `md`+) surfaces every destination (previously `/trips`, `/activity`, `/profile` were multiple taps deep) plus a prominent Add-expense action and account chip — reuses `useTripData()`/`useSession()`, no new data-fetching path. Global `:focus-visible` ring added (previously nonexistent anywhere). New `useDialogA11y` hook (ESC-to-close, reference-counted body-scroll-lock so stacked dialogs don't unlock each other prematurely, focus moved in on open and restored to the trigger on close, Tab trapped in the topmost dialog) applied to `ConfirmSheet`, `ExpenseDetailSheet`, and `LocationPicker` — the latter two previously had neither ESC-to-close nor scroll-lock. Confirmation dialogs default focus to the safe/cancel action, never the destructive one.

**High**: dialogs dock to the bottom on mobile (unchanged) and center with a fade-scale-in on desktop instead of a bottom sheet stuck to a giant screen. Hover states added across every interactive surface that lacked one (new `.glass-interactive` utility, hover-capable pointers only so it never sticks after a mobile tap). Dashboard settlements + recent expenses sit side by side at `lg` widths.

**Medium**: sticky day-group headers on the Expenses list; page-title heading scale bumped at `md`+.

**Post-preview fixes from a physical iPhone review**: the bottom nav was a translucent floating pill with page content visible through it and a visible gap below it before the true screen edge — rewritten as a flush, ~95%-opaque, edge-to-edge bar with a top hairline border (the native iOS tab-bar pattern), its own background now absorbing the safe-area inset instead of leaving a gap beneath it; `--tabbar-clearance` tightened from `6.5rem` to `5rem` to match. Pinch-to-zoom and double-tap-zoom disabled via the standard `maximumScale`/`userScalable` fields on the Next.js `Viewport` export (confirmed in the built HTML's `<meta name="viewport">` tag) — not a JS touch-event hack. "Paytm" payment-app suggestion chip swapped for "Card".

**Verification**: `lint`, `tsc --noEmit`, 52/52 unit tests, and a production build all clean on every commit in this stage; secret-key bundle grep clean. Interactive browser-automation tooling was unavailable for the entire session (Chrome extension unresponsive despite multiple retries and a user-side check), so this was verified via full diff review instead — one real bug was caught and fixed this way (dialog initial focus defaulting to the destructive action instead of the safe one). The primary verification was the user's own review of the Vercel Preview, including a physical iPhone pass that surfaced the two post-preview fixes above.

**Merged and deployed (2026-07-21)**: pushed to `origin/feature/stage4-ux-refinement`, two rounds of Vercel Preview review (first pass, then the iPhone-review fixes), merged to `main` (`1a87b56`) with the user's explicit approval and auto-deployed by Vercel — production status check came back `success`. Post-merge smoke check: `splitzy-delta.vercel.app/` and `/expenses` both `307`→`/login` unauthenticated as expected, `/login` `200` with the pinch-zoom-disabled viewport meta tag confirmed live in the production HTML.

_Previous entry below._

## ✅ Expense Details preview + creator-only edit permissions — MERGED AND LIVE

Clicking any expense opens a bottom-sheet preview (`?view=<id>`, correct browser back-nav) showing exactly what was saved: "Paid by" (trip-member payer) and "Logged by" (authenticated creator) always kept distinct, full split breakdown, payment app, location, trip name, and a collapsible technical section (lat/lng, expense ID, created/updated timestamps). See CHANGELOG "[Expense Details]" for the complete change list.

**Permission model tightened per explicit user decision** (previously creator-or-owner for both edit and delete): **Edit = creator only**, never the trip owner, never a legacy row (`created_by IS NULL`, pre-dating Stage 3's creator tracking). **Delete = creator OR trip owner** — the owner's delete right is moderation/cleanup only and never implies edit access. A non-creator trip owner sees an explanatory note instead of an Edit button; ordinary members see neither Edit nor Delete. Enforced identically in the client (one shared `getExpensePermissions()` helper), the `edit_expense()` RPC body, and the pre-existing `expenses_update_owner_or_creator` RLS policy for delete — never just hidden buttons.

**A real pre-existing gap found and fixed while wiring this in**: the expense list's Delete button was previously shown unconditionally, with no permission gate matching the server-side rule.

**Verification before merge**: `npm test` 52/52 unit (was 43, +9 new permission-helper cases), `npm run test:trip-expense-engine` 42/42 live checks (updated for the new creator-only-edit rule, +2 new legacy-expense-specific checks), `npm run lint` clean, `npm run build` clean (21 routes, all static except the same 6 pre-existing dynamic routes), secret-key bundle grep clean. Live browser verification against production data (signed in as the real account): click-to-open sheet, Paid-by/Logged-by separation, full technical-details section, browser back-button closing the sheet, edit round-trip (form pre-fill → save → redirect back to the updated preview), and delete round-trip (confirmation sheet correctly stacks above the detail sheet, description+amount shown, sheet closes and list refreshes after deletion) — all confirmed working. Legacy-expense handling (a `created_by = null` row) confirmed live: "Logged by" shows an explanatory placeholder rather than being inferred from `paid_by`, only Delete is offered to the owner, with the legacy-specific note.

**Merged and deployed (2026-07-20)**: committed directly to `main` (`5000bed`) with the user's explicit approval and auto-deployed by Vercel — production status check came back `success`. Post-deploy smoke test against `splitzy-delta.vercel.app`: `/` and `/expenses` both `307`→`/login` when signed out, matching expected auth-gated behavior.

**Known pre-existing issue, unrelated to this feature** (not investigated further, out of scope): a hard page-load (full browser navigation, not client-side routing) directly to `/add` hangs indefinitely on the loading skeleton in local dev, with a console warning `The result of getServerSnapshot should be cached to avoid an infinite loop`. Client-side navigation to `/add` (via the in-app "+" button or an Edit action) works correctly. Worth a follow-up investigation into the `useSession`/`useTripData` `useSyncExternalStore` snapshot caching on that route.

_Previous entry below._

## ✅ Stage 3: trip lifecycle, expense splits, balances & settlements — MERGED AND LIVE

Financial-engine stage: 4 expense split methods (equal/exact/percentage/shares), creator-or-owner edit/delete permissions, full trip lifecycle (transfer ownership, leave, hard delete), settlement recording with an optimized minimum-transaction algorithm, and an immutable activity feed. See CHANGELOG "Unreleased" for the complete change list; the CLAUDE.md "Stage 3 financial engine" bullet has the architecture summary.

**Reuse-first**: audited the existing implementation before writing anything (per explicit instruction) — activity logging went in as DB triggers specifically so no already-tested RPC (`create_trip`, `set_trip_member_role`, `claim_invitation`, etc.) needed touching; equal/exact/percentage/shares all funnel through one `compute_expense_splits()` function rather than four separate implementations.

**Two pre-existing bugs found and fixed while wiring this in** (not new regressions — present before this stage): `computeBalances()` was being called without its `settlements` argument on both the dashboard and `/balances`, so recorded settlements never adjusted the displayed balances; `expenses` had an UPDATE RLS policy that let any trip member soft-delete any other member's expense, tightened to creator-or-owner alongside the new `edit_expense()` permission check.

**Verification before merge**: `npx tsc --noEmit` clean, `npm run lint` clean (0 errors, 0 warnings), `npm test` 31/31 unit (was 20 before this stage — added split-validation edge cases and a settlement-optimization case proving the zero-sum-partition pass beats naive greedy), `npm run test:trip-expense-engine` (new) 38/38 live checks against production, `npm run test:db`/`test:auth`/`test:invitations` re-run clean (17/6/24 — no regressions), `npm run build` clean (18 routes, all static except `/api/expenses`, `/auth/callback`, `/join/[token]`). Grepped `.next/static` for the secret key after the build — zero matches.

**Merged and deployed (2026-07-19)**: pushed to `origin/feature/trip-expense-engine` (`849be12`, then a docs commit `d18541c`), Vercel Preview deployed successfully, then merged to `main` (`3d43c6e`) with the user's explicit approval and auto-deployed by Vercel — production status check came back `success`. Post-deploy smoke test against `splitzy-delta.vercel.app`: `/` and `/activity` both `307`→`/login` when signed out, matching the expected auth-gated behavior.

## 📬 Invitations inbox (branch `feature/invitations`)

New `/invitations` page (Settings → Invitations, with a pending-count badge): existing accounts accept/decline directly, no link required. Reuses `claim_invitation()` unchanged for Accept; new narrowly-scoped `decline_invitation()` for Decline (email-match scoped, never touches the member/trip). New-user link flow (`/join/[token]`) untouched. Verified live: `npm run test:invitations` 24/24 (was 13, +8 inbox checks, +3 from the earlier race fix). Full suite re-run clean: 20/20 unit, 17/17 db, 6/6 auth, build clean.

## 🔗 Invitations & member claiming (branch `feature/invitations`)

Shareable token-based invite links, verified live (13/13, `npm run test:invitations`) — see CHANGELOG "Unreleased" for full detail. Audited against the target architecture first (Stage-2 audit report, this session): identity chain, RLS, and the guest-member model were already correct; this work added the missing piece — an actual shareable link with WhatsApp/Copy/Share, replacing the email-only auto-claim as the primary path. `tsc`/`lint`/build clean; `npm test` 18/18; `test:db` 17/17 and `test:auth` 6/6 re-run clean (no regression).

**Manual dashboard step, none required** — `preview_invitation`'s `anon` grant handles the signed-out preview entirely in Postgres; no Supabase URL-configuration changes needed for this feature.

_Previous entry (production merge) below._

## 🔐 Auth Phase 1 on `feature/auth-multi-trip` (not merged): Google + email OTP

New login flow (Google primary, same-screen 8-digit email code, magic link as in-email fallback) with a rewritten callback and friendly error codes. See CHANGELOG "Unreleased".

## ✅ Google OAuth fixed and verified (2026-07-19)

**Root cause was not a code bug**, found via Supabase auth logs: every Google OAuth event traced to `referer: https://splitzy-delta.vercel.app` (production) instead of the Preview origin, because the Preview's exact `redirectTo` wasn't on the Redirect URLs allow-list — GoTrue fell back to Site URL (production, still pre-Google at the time). Fixed by adding the wildcard `https://splitzy-*-snehils-projects-979efd30.vercel.app/**` to Supabase's Redirect URLs (self-healing for every future Preview push, since Supabase's wildcard separators are `.` and `/` only, so `*` correctly spans the per-deployment hash).

**Verified in the auth logs after the fix**: `/authorize` and `/callback` referer both show the Preview origin (`…cl7ow34ic-…vercel.app/auth/callback?next=%2F`), `/callback` → 302 with a successful `login {provider: google}` event, followed by `/token` 200 and `/user` 200 — session fully established and readable. Temporary diagnostic logging added during the investigation has been removed; the SSR cookie-adapter's error logging (previously a silent swallow) stays as permanent hardening.

**Manual Supabase dashboard steps still required (cannot be done via API):**
1. **Email templates** (Authentication → Email Templates): the current default sends only a link. For the code flow the email must show the code, and for cross-context-safe links the URL must use the token-hash form. Update **Magic Link** (and **Confirm signup**, used for first-time-signup emails) to include, e.g.:
   `<p>Your Splitzy code: <strong>{{ .Token }}</strong></p>`
   `<p>Or tap: <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>`
2. **Redirect URLs** (Authentication → URL Configuration): add `http://localhost:3777/**` (dev-server port; only :3000 is allow-listed today).

## ✅ Live in production (`splitzy-delta.vercel.app`)

`feature/auth-multi-trip` merged to `main` (`075a0ef`) with the user's explicit approval and auto-deployed by Vercel. Post-deploy smoke test against the public production domain: `/` and `/settings` 307→`/login` when signed out, `/login` serves the new sign-in page (200), `/api/expenses` returns 401 unauthenticated. The old pre-auth build (and its "permission denied" / stale-identity symptoms) is gone. Remaining before full multi-user rollout: custom SMTP (built-in Supabase email is ~2/hour and team-addresses-only), then invite Shruti & Anshul from `/trips` linking their guest identities.

## ✅ Stage 3: identity/production forensics + product completion (2026-07-19)

- Confirmed the "Anshul greeting + permission denied + network copy" report was entirely the old production build (200 with no login redirect, `/login` 404, "Who are you" present in served HTML). Database mapping was and is correct.
- New: owner role management (`set_trip_member_role` RPC + Make owner/member UI, last-owner demotion blocked), archive/reactivate trip with confirmation sheets, remove-member confirmation sheet, archived-trip read-only guard on Add Expense, honest error copy (network vs generic; raw DB errors dev-only, logged in prod), stale-identity cleanup, build-hash indicator.
- New test infrastructure: `npm test` (8 unit tests: balance math incl. the ₹900 → +600/−300/−300 expectation, settlements, error classification) and `npm run test:db` (17-check live end-to-end: Snehil identity/owner mapping, RLS isolation both directions, onboarding state, trip creation/switching, guest members, paise splits, cross-trip rejection, logout, anon lockout — self-cleaning test sandbox).
- Full verification this pass: typecheck ✓, lint ✓, 8/8 unit ✓, 17/17 db-e2e ✓, build ✓ (15 routes), local route smoke ✓, secret-bundle grep ✓, baseline data re-verified byte-identical (1 trip / 3 members / 3 tm / 3 expenses / 9 eps / ₹900 / Snehil linked + owner).

## 🔐 Stage 2: authenticated multi-trip (complete on branch, not merged)

Full implementation per the approved Stage 0 plan — see CHANGELOG "Unreleased" for the complete change list. Highlights:

- **Auth fixed and verified end-to-end**: "Signups not allowed for otp" was Stage 1's `shouldCreateUser: false` with zero users in `auth.users`; now open-signup + RLS. A disposable-test-user run passed 15/15 checks (magic-link token → session, RLS isolation, anon lockout, RPCs, splits, sign-out), then removed every row it created; baseline re-verified byte-identical (1 trip / 3 members / 3 expenses / ₹900 live / same IDs).
- **Database**: 4 additive migrations (`auth_multitrip_schema`, `authenticated_rls_cutover`, `multitrip_rpcs`, `fix_accept_invitations_qualified_call`). All existing rows and IDs untouched — verified by count/ID/sum comparison before and after. Anonymous access fully removed.
- **Web app**: multi-trip switcher (`/trips`), profile page (`/profile`), invitations + guest members, dashboard stat tiles (Trip Total / You Paid / Your Share / Your Balance), authenticated identity everywhere (no "Who are you?" picker), responsive tab-bar/safe-area/keyboard fixes.
- `tsc --noEmit`, `lint`, `build` clean; secret-key bundle grep clean; dev-server smoke test: all pages 307→`/login` unauthenticated, `/login` 200, `/api/expenses` 401 JSON without a session.

## ⏭ Remaining before merge to main

1. **Human end-to-end pass on the Vercel preview or localhost**: sign up with your real email, create/see trips, invite Shruti & Anshul (linking their guest identities), add + delete an expense from the UI.
2. **Bootstrap Default Trip ownership** (one-time, after Snehil first signs in): no auth user exists yet, so nobody owns Default Trip. Either (a) sign up, create nothing, then ask me to link your user to member "Snehil" + set your `trip_members.role='owner'` on Default Trip (two UPDATE statements I'll present for approval), or (b) abandon Default Trip and recreate the trip in-app (loses the ₹900 test expense's trip context — not recommended).
3. **Custom SMTP before Shruti/Anshul onboard** — built-in email only delivers to project-team addresses (~2/hour).
4. Merge + production deploy (needs your explicit go).

## ✅ Completed

- [x] Supabase project, schema, relationships, `add_equal_expense()`, balance functions (backend, pre-existing)
- [x] Next.js 16 + TypeScript + Tailwind v4 foundation; all starter boilerplate removed
- [x] Design system: semantic tokens, glassmorphism, light/dark themes, no-flash theme script
- [x] Static-shell rendering — every route prerendered, single runtime dependency
- [x] Data layer: typed queries, SWR-style shared cache, optimistic soft delete with rollback
- [x] Client-side balance + greedy settlement math
- [x] Dashboard: greeting, trip summary, animated total, your balance, settlements, recent expenses, quick actions
- [x] Expenses: day-grouped list, emoji, payer, participants, time, location, staggered animations
- [x] Delete flow: bottom-sheet confirmation → soft delete → balances auto-update
- [x] Balances: paid / share / net per member + settlement recommendations ("Shruti → Snehil ₹650")
- [x] Settings: identity picker ("who are you?"), Auto/Light/Dark theme, trip info, about
- [x] Manual Add Expense form: description, amount, payer, split (everyone / choose people), optional payment app + location, calling `add_equal_expense()`; validates inputs client-side, refreshes shared trip data on success
- [x] Loading skeletons, empty states, error states, Supabase-not-configured state
- [x] PWA-ready: manifest, generated app icons, theme-color, safe-area insets
- [x] `.env.local.example`; lint, typecheck and production build all green
- [x] Documentation suite (README, CLAUDE, ARCHITECTURE, UI_GUIDELINES, SETUP, ROADMAP, CHANGELOG)

- [x] Database reconciliation: queries aligned with the real schema (`paid_at`, `status='active'` trip selection, `is_active` members, `location_name`/`payment_app`, `deleted_by`/`deletion_reason` on soft delete, `share_amount`/`share_per_person` fallbacks)
- [x] Confirmed against the live production database (read-only check via Supabase MCP): correct project, all 5 expected public tables present, `add_equal_expense(p_trip_id uuid, p_paid_by_name text, p_amount numeric, p_description text, p_participant_names text[], p_payment_app text, p_paid_at timestamptz, p_latitude numeric, p_longitude numeric, p_location_name text) returns uuid` exists with this exact signature
- [x] `addEqualExpense()` in `queries.ts` finalized with strict types (`AddEqualExpenseInput`) and the real RPC parameter names
- [x] Discovered `add_equal_expense()` is **`service_role`-only** in production (no `EXECUTE` for `anon`/`authenticated`) — re-architected the write path: `.env.local` created (placeholders) with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`; added `src/lib/supabase-server.ts` (secret-key client) and `POST /api/expenses` (validates the request, then calls the RPC server-side); `addEqualExpense()` in `queries.ts` now calls that route instead of the RPC directly. Verified the secret key never reaches the client bundle (`grep` over `.next/static` after `npm run build`: zero matches). `lint`, `tsc --noEmit`, and `build` all green.
- [x] Confirmed `trips.status` uses the literal value `'active'` on live data — the `trips` CHECK constraint restricts it to `'active' | 'completed' | 'archived'`, and the post-migration `anon`-role smoke test below found exactly 1 row with `status = 'active'` ("Default Trip").
- [x] **Applied to production (2026-07-19) and fully verified**: RLS SELECT policies on all 5 tables + a column-scoped `anon` UPDATE on `expenses` (soft-delete columns only). See "Applied" section below for the exact results of every verification query, plus a live `anon`-role read smoke test. Migration name: `anon_select_policies_and_expenses_softdelete_column_grant`.
- [x] **Final production-readiness review (2026-07-19), after real credentials were pasted into `.env.local` and the dev server restarted**: `npx tsc --noEmit` (no `typecheck` script exists in `package.json`; this is the direct equivalent), `npm run lint`, and `npm run build` all clean; `/api/expenses` still builds as `ƒ` (dynamic), everything else `○` (static). Verdict: **READY FOR DEPLOYMENT** — see the "Final review" section below for the full result set. No env-var values were displayed, logged, or read aloud at any point in this pass.

## ✅ Applied & verified: RLS + column-privilege hardening (2026-07-19)

Production had RLS **enabled** on all 5 public tables with **zero policies** — `anon` got zero rows on every read despite holding table-level grants. This is now fixed. The exact SQL that was reviewed, approved, and executed:

```sql
-- Idempotent — RLS is already enabled on all 5, included for completeness.
alter table public.members enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;

-- SELECT-only policies for the anon (browser/publishable-key) role.
create policy "anon_select_members" on public.members
  for select to anon using (true);
create policy "anon_select_trips" on public.trips
  for select to anon using (true);
create policy "anon_select_trip_members" on public.trip_members
  for select to anon using (true);
create policy "anon_select_expenses" on public.expenses
  for select to anon using (true);
create policy "anon_select_expense_participants" on public.expense_participants
  for select to anon using (true);

-- RLS UPDATE policy for anon on expenses only — controls which ROWS may be
-- updated (all of them; there's no per-user ownership model). This alone
-- does NOT protect business columns: RLS restricts rows, never columns.
-- The column-level GRANT below is what actually does that.
create policy "anon_update_expenses" on public.expenses
  for update to anon using (true) with check (true);

-- Table-level SELECT grants (anon already has these; included for idempotency).
grant select on
  public.members, public.trips, public.trip_members,
  public.expenses, public.expense_participants
to anon;

-- Column-level UPDATE grant — NOT a blanket table grant. `anon` may only
-- SET these 3 columns, matching exactly what the existing soft-delete flow
-- sends (softDeleteExpense() in queries.ts). An UPDATE that also touches
-- amount / paid_by / trip_id / description / payment_app /
-- participant_count / share_per_person / paid_at / latitude / longitude /
-- location_name is rejected by Postgres before RLS even runs.
--
-- `anon` currently holds a pre-existing BLANKET table-level UPDATE grant
-- (predates this project) — it must be revoked first, or it would silently
-- override this narrower grant (Postgres ACLs are additive: the broadest
-- applicable grant wins).
revoke update on public.expenses from anon;
grant update (deleted_at, deleted_by, deletion_reason) on public.expenses to anon;
```

### Verification results (all read-only, run immediately after applying)

**Policies created** (`pg_policies`, schema `public`) — exactly 6, matching the SQL exactly:

| Table | Policy | Command |
|---|---|---|
| `expense_participants` | `anon_select_expense_participants` | SELECT |
| `expenses` | `anon_select_expenses` | SELECT |
| `expenses` | `anon_update_expenses` | UPDATE |
| `members` | `anon_select_members` | SELECT |
| `trip_members` | `anon_select_trip_members` | SELECT |
| `trips` | `anon_select_trips` | SELECT |

**Table-level privileges** — `anon` `SELECT` is `true` on all 5 tables. `anon` table-level `UPDATE` on `expenses` reads **`false`** — this turned out to differ from what the earlier draft assumed (`has_table_privilege(...,'update')` was expected to read `true` because *some* column is updatable); in practice Postgres reported `false` here once the blanket grant was revoked and only a column-scoped grant remained. The column-level checks below are the authoritative test either way, and they're exactly right:

**Column-level `UPDATE` privileges on `expenses`** — must be `true` only for the 3 soft-delete columns, `false` for every business column:

| Column | `anon` can UPDATE? |
|---|---|
| `deleted_at` | **true** ✅ |
| `deleted_by` | **true** ✅ |
| `deletion_reason` | **true** ✅ |
| `amount` | false ✅ |
| `paid_by` | false ✅ |
| `trip_id` | false ✅ |
| `description` | false ✅ |
| `payment_app` | false ✅ |
| `participant_count` | false ✅ |
| `share_per_person` | false ✅ |
| `paid_at` | false ✅ |
| `latitude` | false ✅ |
| `longitude` | false ✅ |
| `location_name` | false ✅ |

**`add_equal_expense()` execute privilege for `anon`**: `false` — confirmed still `service_role`-only, unaffected by this migration, exactly as intended.

**Live `anon`-role read smoke test** (ran the actual queries under `SET ROLE anon`, not just privilege introspection — this is what the deployed app will really see):

| Check | Result |
|---|---|
| Active trip found | **1** ("Default Trip") |
| Active members found | **3** |
| Non-deleted expenses found | **1** |
| Expense participants accessible | **3** |

No rows were created, updated, or deleted during any of this — every statement above was `SELECT`/introspection only.

**Security implications:**
- `using (true)` on the SELECT policies makes every row in these 5 tables readable by anyone holding the publishable key — which is not a secret, it's embedded in the shipped JS. Acceptable for a private app used by 3 trusted people with no auth; would need per-user/per-trip scoping if this ever becomes multi-tenant or public.
- `expenses` gets an `anon` **UPDATE** RLS policy (`using (true) with check (true)`, row-scope only) **plus** a **column-level grant restricted to `deleted_at`, `deleted_by`, `deletion_reason`** — the two together mean `anon` can soft-delete any expense row but literally cannot construct an `UPDATE` statement that touches `amount`, `paid_by`, `trip_id`, `description`, `payment_app`, `participant_count`, `share_per_person`, `paid_at`, `latitude`, `longitude`, or `location_name`; Postgres rejects the entire statement at the privilege-check stage if it tries. This replaces the earlier draft's blanket `WITH CHECK (true)`, which relied on RLS alone and left every business column writable.
- Column-level grants don't validate *values* (e.g. they can't require `deletion_reason` to be non-empty) — not a new gap, since the app-level validation for those fields already lives in `softDeleteExpense()`/`ConfirmSheet`, not the database.
- No INSERT or DELETE policy is added anywhere — `add_equal_expense()` stays the only way to create an expense, unreachable by `anon`/`authenticated` (confirmed by the last verification query above), and rows are never hard-deleted.
- Considered and rejected for now: a `BEFORE UPDATE` trigger (duplicates what the column grant already enforces; worth adding later only as defense-in-depth against a future admin re-broadening the grant) and a `SECURITY DEFINER soft_delete_expense()` function mirroring `add_equal_expense()` (the tightest possible boundary — `anon` would need zero direct table privileges — but requires a new SQL function plus changing `softDeleteExpense()` to call `.rpc()` instead of `.update()`, which changes the app's write path where you asked to keep it unchanged).

## ✅ Final production-readiness review (2026-07-19)

Ran after real credentials were pasted into `.env.local` and the dev server restarted. No environment-variable values were displayed, logged, or read aloud at any point.

| Check | Result |
|---|---|
| `npm run typecheck` | No such script in `package.json` — ran `npx tsc --noEmit` instead (the direct equivalent): **clean, zero errors** |
| `npm run lint` | **clean** |
| `npm run build` | **clean** — `/api/expenses` builds as `ƒ` (dynamic), every other route `○` (static) |
| Secret/service-role reference in client-side code | **None found.** `SUPABASE_SECRET_KEY` appears only in `src/lib/supabase-server.ts`; its only importer is `src/app/api/expenses/route.ts` (a Route Handler, never client-bundled); a fresh `grep` over `.next/static` after the build found zero matches; a repo-wide grep for `SUPABASE_SECRET_KEY`/`SERVICE_ROLE` outside `node_modules`/`.next` found nothing else; `next.config.ts` has no `env` block re-exposing server vars |
| `.env.local` excluded from Git | **Confirmed** — matched by `.gitignore`'s `.env*` rule (`git check-ignore -v`); `git ls-files .env.local` returns nothing (never tracked) |
| Add-expense flow architecture | **Confirmed unchanged**: `addEqualExpense()` (`queries.ts`) → `fetch("/api/expenses")` → `POST` handler (`route.ts`) validates → `getSupabaseServer()` → `supabase.rpc("add_equal_expense", ...)`. Browser never touches the RPC directly |
| Soft-delete column scope | **Confirmed unchanged**: `softDeleteExpense()` (`queries.ts`) sets exactly `deleted_at`, `deleted_by`, `deletion_reason` — nothing else, matching the column-level grant applied to production |
| Live dev-server spot check | Local server (port 3777, already running) responds `200` on `/`, page HTML contains no secret-key string; `POST /api/expenses` with a deliberately invalid body correctly returns `400` with a safe message (`"A valid trip is required."`) — validated before ever reaching Supabase, so no DB write occurred |
| Database policy / production data changes this pass | **None** — no blocker was found that would justify one |

**Not yet done (not blockers, just not verified in this pass):** a full interactive browser walkthrough (loading the real dashboard/expenses/balances data, adding a real expense end-to-end, exercising delete) hasn't been driven from a browser — the underlying DB permissions were already confirmed via the `anon`-role smoke test in the prior session (1 active trip, 3 members, 1 expense, 3 participants all visible), and this pass's dev-server spot check confirms the server boots and validates correctly with the real credentials now in place.

## ✅ Pushed to GitHub (2026-07-19)

Repo created and connected: `github.com/snehil2804/splitzy` (private), added as `origin`, `main` pushed and tracking `origin/main`.

Before the first push, ran a full security/git audit:
- `git remote -v` was empty (no remote existed yet) and `gh` wasn't installed — installed via `brew install gh`, then the user authenticated interactively (`gh auth login`, account `snehil2804`) before anything was created or pushed.
- Found `CLAUDE.md` already tracked by git from the initial `create-next-app` commit (it predates this file's current content) and not covered by `.gitignore`. Fixed: added `CLAUDE.md`, `.claude/`, and `.mcp.json` to `.gitignore`, then `git rm --cached CLAUDE.md` (local file untouched, just untracked).
- `.env.local` was already correctly excluded via the existing `.env*` glob in `.gitignore`; confirmed never tracked (`git ls-files` empty) and no `.env*` file appears anywhere in git history.
- Grepped every tracked/staged file for key-shaped patterns (`SUPABASE_SECRET_KEY`, `service_role`, JWT-looking strings, `sk_live`/`sk_test`, PEM headers) — every hit was a doc/comment *referencing* the variable name (or `SETUP.md`'s literal `<PASTE_SECRET_KEY_HERE>` placeholder), never a real value. No secrets in the pushed commit or its history.
- Repo created private (`gh repo create splitzy --private`) since this is a 3-person personal app, not intended for public visibility.
- Commit `aa7b59b` "Prepare Splitzy for Vercel deployment" — 49 files, no `node_modules`/`.next`/build output/credentials.

## 📋 Remaining

- [ ] Add the same 3 env vars to Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) and import `snehil2804/splitzy` as the Vercel project — see SETUP.md
- [ ] Manual/visual walkthrough of the running app against live data (dashboard, expenses, balances, add-expense, delete) — recommended before considering the feature fully done, though not a deployment blocker
- [ ] Visual pass on a real iPhone (safe areas, standalone PWA mode)
- [ ] Apple Shortcut → Edge Function pipeline (Phases 3–4, see ROADMAP.md)
- [ ] Optional: Supabase Realtime subscription so expenses appear live
- [ ] Optional: service worker for offline reads
