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
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | "Publishable key" (`sb_publishable_...`) — the legacy "anon public key" also works | Yes (designed to be public) |
| `SUPABASE_SECRET_KEY` | "Secret key" (`sb_secret_...`) — the legacy "service_role key" also works | **No — server-only, never prefixed `NEXT_PUBLIC_`** |

`SUPABASE_SECRET_KEY` is only ever read in `src/lib/supabase-server.ts`, which is only imported by the `/api/expenses` Route Handler — Next.js never bundles server-only env vars (no `NEXT_PUBLIC_` prefix) into client JavaScript, and this was verified by grepping the production build output.

Restart the dev server after editing `.env.local` (env vars are read at server start / inlined at build time). Until the two `NEXT_PUBLIC_` values are present, the app shows a friendly "Almost there — connect Supabase" screen; until `SUPABASE_SECRET_KEY` is present, `/api/expenses` returns a clear 503 instead of the app crashing.

**On Vercel:** add all three variables under *Project → Settings → Environment Variables* (all environments) — mark `SUPABASE_SECRET_KEY` as a "sensitive"/encrypted variable if the option is available — then redeploy.

## 3. Run

```bash
npm run dev     # http://localhost:3000
npm run build   # production build (all routes static)
npm run lint    # eslint
```

## Database contract

The backend schema already exists and is **not managed here**. This is the real schema (reconciled 2026-07-19) and how the frontend (all queries in `src/lib/queries.ts`) uses it:

| Table                  | Columns (all exist in the DB)                                                                                                    | Frontend usage |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `members`              | `id`, `name`, `is_active`, `created_at`                                                                                           | Only `is_active = true` members are fetched, ordered by `name` |
| `trips`                | `id`, `name`, `description`, `status`, `started_at`, `ended_at`, `created_at`                                                     | The trip with `status = 'active'` is shown; falls back to the newest trip if none is active |
| `trip_members`         | `id`, `trip_id`, `member_id`, `joined_at`, `created_at`                                                                           | Not queried — with three global members, the active-member list is the trip roster |
| `expenses`             | `id`, `trip_id`, `paid_by`, `amount`, `description`, `payment_app`, `paid_at`, `latitude`, `longitude`, `location_name`, `participant_count`, `share_per_person`, `created_at`, `updated_at`, `deleted_at`, `deleted_by`, `deletion_reason` | Ordered by `paid_at` desc; filtered `deleted_at IS NULL`; UI shows `paid_at` (not `created_at`), `payment_app` and `location_name`. `latitude`/`longitude` unused for now (future map feature) |
| `expense_participants` | `id`, `expense_id`, `member_id`, `share_amount`, `created_at`                                                                     | Joined via the FK relationship; `share_amount` is each person's share |

Behavioural notes:

- **Soft delete** = `UPDATE expenses SET deleted_at = now(), deleted_by = <member id of this device's identity, or null>, deletion_reason = 'Deleted from Splitzy web'`.
- Share preference order: `expense_participants.share_amount` → `expenses.share_per_person` → `amount / participant count`.
- `trips.status` is assumed to use the literal value `'active'` for the current trip (constant `TRIP_ACTIVE_STATUS` in `queries.ts` — adjust there if the real value differs).
- Balances and settlements are computed client-side from these rows (see ARCHITECTURE.md).
- `add_equal_expense()` is the write path (Manual Add form / Apple Shortcut). Confirmed signature (2026-07-19, read-only check against production): `add_equal_expense(p_trip_id uuid, p_paid_by_name text, p_amount numeric, p_description text, p_participant_names text[], p_payment_app text, p_paid_at timestamptz, p_latitude numeric, p_longitude numeric, p_location_name text) returns uuid`. **This function is `service_role`-only** — neither `anon` nor `authenticated` has `EXECUTE` on it in production. The browser never calls it directly: `addEqualExpense()` in `queries.ts` posts to `/api/expenses`, a Route Handler that uses the secret-key client (`src/lib/supabase-server.ts`) to make the call server-side. The split math, paise rounding, and payer/participant validation all still live entirely inside the Postgres function.

If anything else in the schema changes, adjust only `src/lib/queries.ts`, `src/lib/types.ts`, and `src/app/api/expenses/route.ts` — nothing else touches the database.

RLS note: the app uses the publishable key with no auth, so the `members`, `trips`, `trip_members`, `expenses`, `expense_participants` tables need `anon` `SELECT`, and `expenses` needs `anon` `UPDATE` (for soft delete). **As of 2026-07-19, production has RLS enabled on all 5 tables with zero policies defined**, which means `anon` currently gets zero rows on every read despite holding the table-level grants — this must be fixed with RLS policies (proposed, not yet applied — pending approval) before live data will appear. Appropriate for a private app shared by three trusted people; lock down further (e.g. per-trip scoping) when auth is added.

---

## Stage 2 addendum (2026-07-19, branch `feature/auth-multi-trip`)

The contract above predates authentication. What changed (see CHANGELOG "Unreleased" for full detail):

- **Auth**: Supabase magic-link (PKCE) with open signup; sessions in cookies via `@supabase/ssr`; `src/proxy.ts` gates every page.
- **New tables**: `profiles` (one per auth user, trigger-created), `invitations` (owner-issued; optionally linked to an unclaimed guest member so accepting claims that identity).
- **New columns**: `members.user_id` (null = guest member), `trips.created_by`, `trip_members.role` (`owner`/`member`) + `is_active` + `left_at`, `expenses.created_by`. `participant_count` CHECK widened to `>= 1`.
- **RLS**: `anon` fully revoked. `authenticated` reads are scoped to active trip membership; writes are column-scoped grants (expenses soft-delete cols; trips name/description/status/ended_at for owners; own profiles.display_name) or SECURITY DEFINER RPCs: `create_trip`, `add_guest_member`, `invite_member`, `revoke_invitation`, `accept_my_invitations`, `set_trip_member_active`, `ensure_my_member`, `add_expense`.
- **Write path**: the web form now calls `add_expense()` (ID-based, any trip size) directly from the browser. `POST /api/expenses` + `add_equal_expense()` remain only for the future Apple Shortcut path, now requiring a session (401) and trip membership (403). Note `add_equal_expense()` internally hardcodes the original three names for its "Everyone" option — do not use it for new trips.
- **`trip_members` is now queried** — it is the per-trip roster and role source; the old "3 global members" note above no longer applies.
