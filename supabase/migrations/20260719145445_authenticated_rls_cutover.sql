-- Stage 2: authenticated, membership-scoped RLS. Anonymous access removed
-- entirely (the app now requires login before any data screen).
-- Authorization-only: no table rows are touched.

-- ── remove all anon access ──────────────────────────────────────────────────
drop policy anon_select_members on public.members;
drop policy anon_select_trips on public.trips;
drop policy anon_select_trip_members on public.trip_members;
drop policy anon_select_expenses on public.expenses;
drop policy anon_select_expense_participants on public.expense_participants;
drop policy anon_update_expenses on public.expenses;

revoke all on public.members, public.trips, public.trip_members,
  public.expenses, public.expense_participants,
  public.profiles, public.invitations from anon;

-- ── table-level grants for authenticated: reads everywhere policies allow;
--    writes only where a policy + column grant explicitly permits.
--    All other writes go through SECURITY DEFINER RPCs. ────────────────────
revoke all on public.members, public.trips, public.trip_members,
  public.expenses, public.expense_participants,
  public.profiles, public.invitations from authenticated;

grant select on public.members, public.trips, public.trip_members,
  public.expenses, public.expense_participants,
  public.profiles, public.invitations to authenticated;

-- Soft delete: same column-scoped pattern previously used for anon.
grant update (deleted_at, deleted_by, deletion_reason)
  on public.expenses to authenticated;

-- Trip management (rename / archive / describe / end) — row scope is
-- enforced by the owner policy below.
grant update (name, description, status, ended_at)
  on public.trips to authenticated;

-- Own profile edits.
grant update (display_name) on public.profiles to authenticated;

-- ── policies ────────────────────────────────────────────────────────────────
-- profiles: own row only.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- members: your own identity row, plus anyone you share an active trip with.
create policy members_select_shared on public.members
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.trip_members tm
      where tm.member_id = members.id
        and tm.is_active
        and public.is_trip_member(tm.trip_id)
    )
  );

-- trips: members read; owners manage (columns limited by the grant above).
create policy trips_select_member on public.trips
  for select to authenticated using (public.is_trip_member(id));
create policy trips_update_owner on public.trips
  for update to authenticated
  using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));

-- trip_members: visible to fellow trip members.
create policy trip_members_select_member on public.trip_members
  for select to authenticated using (public.is_trip_member(trip_id));

-- expenses: trip members read and soft-delete (columns limited by grant).
create policy expenses_select_member on public.expenses
  for select to authenticated using (public.is_trip_member(trip_id));
create policy expenses_update_member on public.expenses
  for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- expense_participants: readable when the parent expense's trip is yours.
create policy expense_participants_select_member on public.expense_participants
  for select to authenticated using (public.is_expense_member(expense_id));

-- invitations: trip owners see their trip's invites; invitees see their own.
create policy invitations_select_own on public.invitations
  for select to authenticated using (
    public.is_trip_owner(trip_id)
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
