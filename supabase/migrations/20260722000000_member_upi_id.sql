-- Adds an optional, self-service UPI payment ID per member, for the
-- "Pay via UPI" settlement flow. Additive only: one nullable column, one
-- format CHECK constraint, one column-scoped grant, one new RLS policy.
-- Nothing existing is altered, dropped, or renamed.
--
-- Storage choice: `members`, not `profiles`. `Settlement.to`/`.from` are
-- already `Member` objects and the existing member fetch
-- (`trip_members.select("*, members(*)")`) already selects `members.*`, so
-- this flows through with zero query-shape change. `profiles` is 1:1 with
-- `auth.users` only, so guest members (`user_id is null`) could never have
-- one there.
--
-- Authorization: mirrors the existing `profiles.display_name` self-service
-- pattern exactly (see `20260719145445_authenticated_rls_cutover.sql`) — a
-- column-scoped `grant update (upi_id)` plus a `using`/`with check
-- (user_id = auth.uid())` policy, no RPC. Because the grant covers only
-- `upi_id`, Postgres rejects any update touching `name`/`is_active`/
-- `user_id` before RLS even runs, so one member can never silently change
-- another's UPI ID — including the trip owner, who gets no write path here
-- at all (only the informational "ask them to add one" UI copy, no schema
-- change needed for that).

alter table public.members add column upi_id text;

comment on column public.members.upi_id is
  'Self-reported UPI payment handle (e.g. name@bank). Saving this does not verify bank ownership — see profile page copy. Self-service only, see members_update_own_upi_id policy.';

-- Format validation, enforced for every write path present or future, not
-- just the self-service one below. Deliberately permissive (UPI handles
-- vary in the characters they allow before the @) rather than pretending to
-- verify a specific bank/PSP's exact rules.
alter table public.members add constraint members_upi_id_format
  check (upi_id is null or upi_id ~ '^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$');

grant update (upi_id) on public.members to authenticated;

create policy members_update_own_upi_id on public.members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
