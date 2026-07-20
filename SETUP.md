# Setup

## 1. Install

```bash
npm install
```

## 2. Environment variables

`.env.local` already exists with placeholders (see it in the repo root) — edit it directly, replacing each `<PASTE_..._HERE>` value:

```
NEXT_PUBLIC_SUPABASE_URL=<PASTE_PROJECT_URL_HERE>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PASTE_PUBLISHABLE_KEY_HERE>
SUPABASE_SECRET_KEY=<PASTE_SECRET_KEY_HERE>
```

Where to find each value — Supabase Dashboard → Project Settings → API:

| Variable | Source | Exposed to browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | "Project URL" | Yes (safe — it's just the endpoint) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | "Publishable key" (`sb_publishable_...`) — the legacy "anon public key" also works | Yes (designed to be public — access is enforced entirely by RLS, not by keeping this secret) |
| `SUPABASE_SECRET_KEY` | "Secret key" (`sb_secret_...`) — the legacy "service_role key" also works | **No — server-only, never prefixed `NEXT_PUBLIC_`** |

`SUPABASE_SECRET_KEY` is only ever read in `src/lib/supabase-server.ts`, which is only imported by the `/api/expenses` Route Handler — Next.js never bundles server-only env vars (no `NEXT_PUBLIC_` prefix) into client JavaScript, and this was verified by grepping the production build output.

Restart the dev server after editing `.env.local` (env vars are read at server start / inlined at build time). Until the two `NEXT_PUBLIC_` values are present, the app shows a friendly "Almost there — connect Supabase" screen; until `SUPABASE_SECRET_KEY` is present, `/api/expenses` returns a clear 503 instead of the app crashing.

**On Vercel:** add all three variables under *Project → Settings → Environment Variables* (all environments) — mark `SUPABASE_SECRET_KEY` as a "sensitive"/encrypted variable if the option is available — then redeploy.

## 3. Auth configuration (Supabase Dashboard)

Sign-in is Google OAuth (primary) plus a same-screen 8-digit email code, with a tappable link as an email-only fallback. Two manual dashboard steps, since they can't be scripted:

1. **Email templates** (Authentication → Email Templates) — the default template only shows a link. Update **Magic Link** (and **Confirm signup**) to also surface the code and a cross-context-safe link:
   ```html
   <p>Your Splitzy code: <strong>{{ .Token }}</strong></p>
   <p>Or tap: <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   ```
2. **Redirect URLs** (Authentication → URL Configuration) — add your dev server origin (e.g. `http://localhost:3000/**`) and, for Vercel Previews, a wildcard covering every deployment: `https://<project>-*-<team>.vercel.app/**`.

## 4. Run

```bash
npm run dev     # http://localhost:3000
npm run build   # production build (static except a few server-only routes)
npm run lint    # eslint
npm run typecheck  # tsc --noEmit
npm test        # unit tests (tests/**/*.test.ts)
```

Live end-to-end suites run against the real Supabase project in a disposable sandbox (creates test users/trips, asserts, then deletes everything it created):

```bash
npm run test:db                    # identity, RLS isolation, trip switching, paise-exact splits
npm run test:auth                  # OTP/code sign-in, PKCE-free token_hash verify
npm run test:invitations           # invite links, claim security, inbox accept/decline
npm run test:trip-expense-engine   # split methods, permissions, settlements, activity log, trip lifecycle
```

## Database contract

This repo **owns its migrations** (`supabase/migrations/`, applied via the Supabase MCP tools, always additive, always verified against a live before/after data snapshot). This is the current schema and how the frontend (`src/lib/queries.ts`, the only file that talks to the database) uses it.

### Tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `email`, `display_name` | One per auth user, trigger-created on signup |
| `members` | `id`, `name`, `is_active`, `user_id` | A trip identity. `user_id = null` means an unclaimed guest — added by name, invited later |
| `trips` | `id`, `name`, `description`, `status`, `started_at`, `ended_at`, `created_by` | `status` is `'active' \| 'completed' \| 'archived'`; the active trip is shown by default, falling back to the newest |
| `trip_members` | `id`, `trip_id`, `member_id`, `role`, `is_active`, `joined_at`, `left_at` | The per-trip roster and role (`owner`/`member`); a member can belong to multiple trips |
| `invitations` | `id`, `trip_id`, `email` (nullable), `member_id`, `token`, `expires_at`, `role`, `status` | Token is the primary claim mechanism (`/join/[token]`); email is an optional secondary auto-claim + inbox listing |
| `expenses` | `id`, `trip_id`, `paid_by`, `amount`, `description`, `payment_app`, `paid_at`, `location_name`, `latitude`/`longitude` (unused), `split_type`, `category`, `notes`, `currency`, `created_by`, `participant_count`, `share_per_person`, `offline_idempotency_key`, `deleted_at`/`deleted_by`/`deletion_reason` | Ordered by `paid_at` desc (not `created_at`); filtered `deleted_at IS NULL`. `split_type` is `'equal' \| 'exact' \| 'percentage' \| 'shares'`. `offline_idempotency_key` is null for every normal online expense and set only by the offline sync path — a partial unique index on `(created_by, offline_idempotency_key) WHERE key IS NOT NULL` is what makes a retried sync return the existing row instead of duplicating it |
| `expense_participants` | `id`, `expense_id`, `member_id`, `share_amount`, `share_percentage`, `share_units` | `share_percentage`/`share_units` are only populated for those split types; `share_amount` (rupees) is always populated |
| `settlements` | `id`, `trip_id`, `from_member_id`, `to_member_id`, `amount`, `note`, `settled_by` | A recorded (already-paid) settlement — distinct from the *suggested* settlements `computeSettlements()` produces client-side |
| `activity_log` | `id`, `trip_id`, `actor_member_id`, `action`, `description`, `metadata` | Immutable, append-only, populated entirely by database triggers — never written to directly |

### Writes

Almost nothing is a direct table write. Reads are RLS-scoped to `is_trip_member(trip_id)`; writes go through one of:

- **Narrow column-level grants** (`authenticated` only): `expenses` soft-delete columns (`deleted_at`/`deleted_by`/`deletion_reason`); `trips` `name`/`description`/`status`/`ended_at` (owner-only via RLS); a user's own `profiles.display_name`.
- **`SECURITY DEFINER` RPCs**, each re-validating membership/ownership/business rules server-side regardless of what the client sends:
  - Trips: `create_trip`, `delete_trip` (owner-only, atomic hard delete of everything under the trip), `leave_trip` (blocked for a sole owner), `transfer_trip_ownership` (owner-only)
  - Members: `add_guest_member`, `set_trip_member_active`, `set_trip_member_role` (owner-only)
  - Invitations: `invite_member`, `revoke_invitation`, `claim_invitation`, `list_my_invitations`, `decline_invitation`, `accept_my_invitations`; `preview_invitation` is the one deliberate `anon` grant (unauthenticated link preview)
  - Expenses: `add_expense`, `edit_expense` (creator or trip owner only)
  - Settlements: `record_settlement` (any trip member)
  - Internal helpers, revoked from direct RPC-callability: `compute_expense_splits` (the single split-math implementation all four split types funnel through, using the largest-remainder method for paise-exact rounding), `ensure_my_member`, the four `log_*_activity()` activity-log trigger functions

`anon` has **zero access** anywhere — every table requires an authenticated session with active membership on the relevant trip.

### Legacy write path (kept for the future Apple Shortcut)

`add_equal_expense(p_trip_id uuid, p_paid_by_name text, p_amount numeric, p_description text, p_participant_names text[], p_payment_app text, p_paid_at timestamptz, p_latitude numeric, p_longitude numeric, p_location_name text) returns uuid` is **`service_role`-only** — neither `anon` nor `authenticated` has `EXECUTE` on it. It's name-based (not ID-based) so it can work from a context with no session, like a future Shortcut. The browser never calls it directly: `addEqualExpense()` in `queries.ts` posts to `POST /api/expenses`, gated by session (401) and trip membership (403), which uses the secret-key client (`src/lib/supabase-server.ts`) to make the call server-side. The in-app Add/Edit Expense forms use `add_expense()`/`edit_expense()` instead — ID-based, called directly from the browser, no API route needed.

### Behavioural notes

- **Soft delete** (expenses only) = `UPDATE expenses SET deleted_at = now(), deleted_by = <acting member id, or null>, deletion_reason = ...`; reads filter `deleted_at IS NULL`. Only the expense's creator or the trip owner can do this (RLS).
- **Hard delete** (trips only) = owner-only `delete_trip()` RPC, atomic, FK-safe order (`activity_log` → `settlements` → `invitations` → `expense_participants` → `expenses` → `trip_members` → `trips`).
- Share amount preference order: `expense_participants.share_amount` → `expenses.share_per_person` → `amount / participant_count` (only the first applies for any expense created after Stage 3, since every split type populates `share_amount`).
- Balances and settlement suggestions are computed client-side from these rows (see ARCHITECTURE.md); recorded `settlements` rows are folded into that computation as adjustments.

If anything in the live schema changes, adjust only `src/lib/queries.ts` and `src/lib/types.ts` — nothing else touches the database directly.
