# Project Status

_Last updated: 2026-07-19 (**MERGED TO MAIN + DEPLOYED TO PRODUCTION** — `075a0ef`)_

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
