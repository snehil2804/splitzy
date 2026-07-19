-- Stage 3 follow-up: fix an overload bug and close two advisor findings
-- from the trip_expense_engine migration.

-- add_expense() gained new trailing params via `create or replace`, which
-- only replaces a function with the *exact same* signature — a changed
-- parameter list creates a second overload instead, leaving the old
-- 8-param add_expense() still live alongside the new 12-param one. Two
-- overloads that can both match a call using only the original 8 named
-- args is genuinely ambiguous. Drop the stale one; the 12-param version's
-- trailing defaults already make it fully backward compatible on its own.
drop function if exists public.add_expense(
  uuid, uuid, numeric, text, uuid[], text, timestamptz, text
);

-- The activity-log trigger functions must only ever run as triggers, never
-- be invoked directly via the REST RPC surface — same hardening already
-- applied to handle_new_user() in an earlier migration.
revoke execute on function public.log_expense_activity() from public, anon, authenticated;
revoke execute on function public.log_trip_member_activity() from public, anon, authenticated;
revoke execute on function public.log_invitation_activity() from public, anon, authenticated;
revoke execute on function public.log_settlement_activity() from public, anon, authenticated;
