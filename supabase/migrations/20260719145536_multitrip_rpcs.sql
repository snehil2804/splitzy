-- Stage 2: write-path RPCs. All writes (except the column-scoped soft-delete
-- and owner trip-updates) go through these SECURITY DEFINER functions, so
-- validation lives in exactly one place per operation.
--
-- NOTE: accept_my_invitations() below has a bug (unqualified greatest_role()
-- call under search_path='') fixed by the following migration,
-- 20260719145549_fix_accept_invitations_qualified_call.sql. Kept as applied.

-- Finds the caller's member row, creating one from their profile if needed.
-- members.name is globally unique, so collide-and-suffix rather than fail.
create or replace function public.ensure_my_member(p_preferred_name text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member_id uuid;
  v_name text;
  v_candidate text;
  v_suffix int := 2;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select id into v_member_id from public.members where user_id = v_uid;
  if v_member_id is not null then
    return v_member_id;
  end if;

  select coalesce(
    nullif(trim(p_preferred_name), ''),
    nullif(trim(display_name), ''),
    split_part(email, '@', 1)
  ) into v_name
  from public.profiles where id = v_uid;

  if v_name is null or length(trim(v_name)) = 0 then
    raise exception 'Could not determine a member name.';
  end if;

  v_candidate := v_name;
  loop
    begin
      insert into public.members (name, user_id)
      values (v_candidate, v_uid)
      returning id into v_member_id;
      return v_member_id;
    exception when unique_violation then
      -- Name taken (possibly an unclaimed guest). Never auto-claim someone
      -- else's row on a name match — claiming happens only via invitations.
      v_candidate := v_name || ' ' || v_suffix;
      v_suffix := v_suffix + 1;
      if v_suffix > 50 then
        raise exception 'Could not create a unique member name.';
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.create_trip(
  p_name text,
  p_member_name text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_trip_id uuid;
  v_member_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Trip name is required.';
  end if;

  v_member_id := public.ensure_my_member(p_member_name);

  insert into public.trips (name, created_by)
  values (trim(p_name), v_uid)
  returning id into v_trip_id;

  insert into public.trip_members (trip_id, member_id, role)
  values (v_trip_id, v_member_id, 'owner');

  return v_trip_id;
end;
$$;

create or replace function public.add_guest_member(
  p_trip_id uuid,
  p_name text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can add members.';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Member name is required.';
  end if;

  select id into v_member_id
  from public.members where lower(name) = lower(trim(p_name));

  if v_member_id is null then
    insert into public.members (name) values (trim(p_name))
    returning id into v_member_id;
  end if;

  if exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and member_id = v_member_id and is_active
  ) then
    raise exception '% is already a member of this trip.', trim(p_name);
  end if;

  -- Re-activate a previously removed member instead of duplicating the row.
  update public.trip_members
  set is_active = true, left_at = null
  where trip_id = p_trip_id and member_id = v_member_id and not is_active;

  if not found then
    insert into public.trip_members (trip_id, member_id, role)
    values (p_trip_id, v_member_id, 'member');
  end if;

  return v_member_id;
end;
$$;

create or replace function public.invite_member(
  p_trip_id uuid,
  p_email text,
  p_member_id uuid default null,
  p_role text default 'member'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invitation_id uuid;
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can invite members.';
  end if;
  if p_email is null or position('@' in p_email) <= 1 then
    raise exception 'A valid email is required.';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member.';
  end if;
  if p_member_id is not null then
    if not exists (
      select 1 from public.trip_members tm
      join public.members m on m.id = tm.member_id
      where tm.trip_id = p_trip_id and tm.member_id = p_member_id
        and m.user_id is null
    ) then
      raise exception 'That member is not an unclaimed member of this trip.';
    end if;
  end if;

  begin
    insert into public.invitations (trip_id, email, member_id, role, invited_by)
    values (p_trip_id, lower(trim(p_email)), p_member_id, p_role, v_uid)
    returning id into v_invitation_id;
  exception when unique_violation then
    raise exception 'That email already has a pending invitation to this trip.';
  end;

  return v_invitation_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id
  from public.invitations where id = p_invitation_id and status = 'pending';
  if v_trip_id is null then
    raise exception 'No pending invitation found.';
  end if;
  if not public.is_trip_owner(v_trip_id) then
    raise exception 'Only the trip owner can revoke invitations.';
  end if;
  update public.invitations set status = 'revoked' where id = p_invitation_id;
end;
$$;

-- Called after login: accepts every pending invitation addressed to the
-- caller's email. Claims the targeted guest member row (preserving its ID
-- and expense history) when the caller has no member identity yet.
create or replace function public.accept_my_invitations()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  v_inv record;
  v_member_id uuid;
  v_accepted int := 0;
begin
  if v_uid is null or v_email = '' then return 0; end if;

  for v_inv in
    select * from public.invitations
    where status = 'pending' and lower(email) = v_email
    order by created_at
  loop
    select id into v_member_id from public.members where user_id = v_uid;

    if v_member_id is null and v_inv.member_id is not null then
      -- Claim the targeted guest member (keeps existing IDs and history).
      update public.members set user_id = v_uid
      where id = v_inv.member_id and user_id is null;
      if found then v_member_id := v_inv.member_id; end if;
    end if;

    if v_member_id is null then
      v_member_id := public.ensure_my_member(null);
    end if;

    update public.trip_members
    set is_active = true, left_at = null,
        role = greatest_role(role, v_inv.role)
    where trip_id = v_inv.trip_id and member_id = v_member_id;

    if not found then
      insert into public.trip_members (trip_id, member_id, role)
      values (v_inv.trip_id, v_member_id, v_inv.role);
    end if;

    update public.invitations
    set status = 'accepted', accepted_at = now()
    where id = v_inv.id;

    v_accepted := v_accepted + 1;
  end loop;

  return v_accepted;
end;
$$;

-- 'owner' outranks 'member'; never demote on invitation accept.
create or replace function public.greatest_role(a text, b text)
returns text
language sql immutable set search_path = ''
as $$ select case when a = 'owner' or b = 'owner' then 'owner' else 'member' end $$;

create or replace function public.set_trip_member_active(
  p_trip_id uuid,
  p_member_id uuid,
  p_active boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can manage members.';
  end if;
  if not p_active and exists (
    select 1 from public.trip_members tm
    join public.members m on m.id = tm.member_id
    where tm.trip_id = p_trip_id and tm.member_id = p_member_id
      and tm.role = 'owner' and m.user_id = (select auth.uid())
  ) and not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and role = 'owner' and is_active
      and member_id <> p_member_id
  ) then
    raise exception 'A trip must keep at least one active owner.';
  end if;

  update public.trip_members
  set is_active = p_active,
      left_at = case when p_active then null else now() end
  where trip_id = p_trip_id and member_id = p_member_id;

  if not found then
    raise exception 'That member is not part of this trip.';
  end if;
end;
$$;

-- ID-based expense creation for any trip size. Split math mirrors
-- add_equal_expense() exactly: paise-precise base share with the remainder
-- distributed one paisa at a time to the first participants.
create or replace function public.add_expense(
  p_trip_id uuid,
  p_paid_by uuid,
  p_amount numeric,
  p_description text,
  p_participant_ids uuid[],
  p_payment_app text default null,
  p_paid_at timestamptz default now(),
  p_location_name text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expense_id uuid;
  v_ids uuid[];
  v_count int;
  v_amount_cents bigint;
  v_base_share_cents bigint;
  v_remaining_cents int;
  v_average_share numeric(12,2);
  v_position int;
  v_share_cents bigint;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'You are not a member of this trip.';
  end if;
  if not exists (
    select 1 from public.trips where id = p_trip_id and status = 'active'
  ) then
    raise exception 'The selected trip does not exist or is not active.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if round(p_amount, 2) <> p_amount then
    raise exception 'Amount cannot contain more than two decimal places.';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'Description is required.';
  end if;

  select array_agg(distinct pid) into v_ids
  from unnest(p_participant_ids) pid where pid is not null;
  v_count := coalesce(cardinality(v_ids), 0);
  if v_count = 0 then
    raise exception 'At least one participant must be selected.';
  end if;

  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and member_id = p_paid_by and is_active
  ) then
    raise exception 'The payer is not an active member of this trip.';
  end if;
  if exists (
    select 1 from unnest(v_ids) pid
    where not exists (
      select 1 from public.trip_members
      where trip_id = p_trip_id and member_id = pid and is_active
    )
  ) then
    raise exception 'Every participant must be an active member of this trip.';
  end if;

  v_amount_cents := round(p_amount * 100)::bigint;
  v_base_share_cents := v_amount_cents / v_count;
  v_remaining_cents := mod(v_amount_cents, v_count)::int;
  v_average_share := round(p_amount / v_count, 2);

  insert into public.expenses (
    trip_id, paid_by, amount, description, payment_app, paid_at,
    location_name, participant_count, share_per_person, created_by
  ) values (
    p_trip_id, p_paid_by, p_amount, trim(p_description),
    nullif(trim(p_payment_app), ''), coalesce(p_paid_at, now()),
    nullif(trim(p_location_name), ''), v_count, v_average_share, v_uid
  ) returning id into v_expense_id;

  for v_position in 1..v_count loop
    v_share_cents := v_base_share_cents;
    if v_position <= v_remaining_cents then
      v_share_cents := v_share_cents + 1;
    end if;
    insert into public.expense_participants (expense_id, member_id, share_amount)
    values (v_expense_id, v_ids[v_position], v_share_cents / 100.0);
  end loop;

  return v_expense_id;
end;
$$;

-- Lock all RPCs to signed-in users only.
revoke execute on function
  public.ensure_my_member(text),
  public.create_trip(text, text),
  public.add_guest_member(uuid, text),
  public.invite_member(uuid, text, uuid, text),
  public.revoke_invitation(uuid),
  public.accept_my_invitations(),
  public.greatest_role(text, text),
  public.set_trip_member_active(uuid, uuid, boolean),
  public.add_expense(uuid, uuid, numeric, text, uuid[], text, timestamptz, text)
from public, anon;

grant execute on function
  public.ensure_my_member(text),
  public.create_trip(text, text),
  public.add_guest_member(uuid, text),
  public.invite_member(uuid, text, uuid, text),
  public.revoke_invitation(uuid),
  public.accept_my_invitations(),
  public.set_trip_member_active(uuid, uuid, boolean),
  public.add_expense(uuid, uuid, numeric, text, uuid[], text, timestamptz, text)
to authenticated;
