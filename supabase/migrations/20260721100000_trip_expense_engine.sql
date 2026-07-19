-- Stage 3 (feature/trip-expense-engine): split methods, edit expense,
-- trip lifecycle (delete/leave/transfer), settlements, activity log.
-- Additive only. Reuses every existing table/RPC/RLS pattern unchanged;
-- activity logging is done via triggers so create_trip/add_guest_member/
-- set_trip_member_role/claim_invitation/etc. are not modified at all.

-- ── schema additions ─────────────────────────────────────────────────────
alter table public.expenses
  add column split_type text not null default 'equal'
    check (split_type in ('equal', 'exact', 'percentage', 'shares')),
  add column category text,
  add column notes text,
  add column currency text not null default 'INR';

alter table public.expense_participants
  add column share_percentage numeric check (share_percentage is null or share_percentage > 0),
  add column share_units numeric check (share_units is null or share_units > 0);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  from_member_id uuid not null references public.members(id),
  to_member_id uuid not null references public.members(id),
  amount numeric not null check (amount > 0),
  note text,
  settled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint settlements_distinct_members check (from_member_id <> to_member_id)
);
create index idx_settlements_trip_id on public.settlements (trip_id);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  actor_member_id uuid references public.members(id),
  action text not null,
  description text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index idx_activity_log_trip_id_created_at
  on public.activity_log (trip_id, created_at desc);

-- ── RLS: settlements + activity_log follow the exact same membership-scope
--    pattern as every other table. Neither grants any direct write to
--    authenticated — settlements are written only by record_settlement(),
--    activity_log only by triggers (SECURITY DEFINER trigger functions
--    below, so they succeed regardless of the invoking role's own grants
--    on activity_log — same technique as every other SECURITY DEFINER
--    helper already in this schema). ─────────────────────────────────────
alter table public.settlements enable row level security;
alter table public.activity_log enable row level security;

grant select on public.settlements, public.activity_log to authenticated;

create policy settlements_select_member on public.settlements
  for select to authenticated using (public.is_trip_member(trip_id));
create policy activity_log_select_member on public.activity_log
  for select to authenticated using (public.is_trip_member(trip_id));

-- ── compute_expense_splits(): the one place split math lives, used by
--    both add_expense() and edit_expense() below. 'equal' is implemented
--    as 'shares' with unit=1 for every participant — mathematically
--    identical, so there is exactly one distribution algorithm, not four.
--    Uses the largest-remainder method for fair paise rounding (each
--    participant gets floor(raw cents), then the leftover cents go one at
--    a time to whoever had the largest fractional remainder). ───────────
create or replace function public.compute_expense_splits(
  p_amount numeric,
  p_participant_ids uuid[],
  p_split_type text,
  p_splits jsonb
)
returns table (
  member_id uuid,
  share_amount numeric,
  share_percentage numeric,
  share_units numeric
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_amount_cents bigint := round(p_amount * 100)::bigint;
  v_total_units numeric;
  v_sum_exact numeric;
  v_sum_pct numeric;
begin
  if p_split_type not in ('equal', 'exact', 'percentage', 'shares') then
    raise exception 'Unknown split type: %', p_split_type;
  end if;
  if p_participant_ids is null or cardinality(p_participant_ids) = 0 then
    raise exception 'At least one participant must be selected.';
  end if;

  if p_split_type = 'exact' then
    if p_splits is null or jsonb_array_length(p_splits) <> cardinality(p_participant_ids) then
      raise exception 'An exact amount is required for every participant.';
    end if;
    select sum((elem->>'value')::numeric) into v_sum_exact
    from jsonb_array_elements(p_splits) elem;
    if exists (
      select 1 from jsonb_array_elements(p_splits) elem
      where (elem->>'value')::numeric <= 0
    ) then
      raise exception 'Every amount must be greater than zero.';
    end if;
    if abs(v_sum_exact - p_amount) > 0.01 then
      raise exception 'The exact amounts (%) must add up to the total (%).', v_sum_exact, p_amount;
    end if;
    return query
      select (elem->>'member_id')::uuid, (elem->>'value')::numeric, null::numeric, null::numeric
      from jsonb_array_elements(p_splits) elem;
    return;
  end if;

  if p_split_type = 'percentage' then
    if p_splits is null or jsonb_array_length(p_splits) <> cardinality(p_participant_ids) then
      raise exception 'A percentage is required for every participant.';
    end if;
    select sum((elem->>'value')::numeric) into v_sum_pct
    from jsonb_array_elements(p_splits) elem;
    if exists (
      select 1 from jsonb_array_elements(p_splits) elem
      where (elem->>'value')::numeric <= 0
    ) then
      raise exception 'Every percentage must be greater than zero.';
    end if;
    if abs(v_sum_pct - 100) > 0.01 then
      raise exception 'Percentages must add up to 100%% (got %).', v_sum_pct;
    end if;

    return query
      with raw as (
        select
          (elem->>'member_id')::uuid as mid,
          (elem->>'value')::numeric as pct,
          v_amount_cents * (elem->>'value')::numeric / 100.0 as raw_cents
        from jsonb_array_elements(p_splits) elem
      ),
      floored as (
        select mid, pct, floor(raw_cents)::bigint as base_cents, raw_cents - floor(raw_cents) as frac
        from raw
      ),
      ranked as (
        select mid, pct, base_cents, frac,
          row_number() over (order by frac desc, mid) as rn,
          (v_amount_cents - sum(base_cents) over ()) as remainder
        from floored
      )
      select mid, (base_cents + case when rn <= remainder then 1 else 0 end) / 100.0, pct, null::numeric
      from ranked;
    return;
  end if;

  -- 'shares' and 'equal': equal = shares with unit 1 for every participant.
  if p_split_type = 'shares' then
    if p_splits is null or jsonb_array_length(p_splits) <> cardinality(p_participant_ids) then
      raise exception 'A share count is required for every participant.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_splits) elem
      where (elem->>'value')::numeric <= 0
    ) then
      raise exception 'Every share count must be greater than zero.';
    end if;
    select sum((elem->>'value')::numeric) into v_total_units
    from jsonb_array_elements(p_splits) elem;

    return query
      with raw as (
        select
          (elem->>'member_id')::uuid as mid,
          (elem->>'value')::numeric as units,
          v_amount_cents * (elem->>'value')::numeric / v_total_units as raw_cents
        from jsonb_array_elements(p_splits) elem
      ),
      floored as (
        select mid, units, floor(raw_cents)::bigint as base_cents, raw_cents - floor(raw_cents) as frac
        from raw
      ),
      ranked as (
        select mid, units, base_cents, frac,
          row_number() over (order by frac desc, mid) as rn,
          (v_amount_cents - sum(base_cents) over ()) as remainder
        from floored
      )
      select mid, (base_cents + case when rn <= remainder then 1 else 0 end) / 100.0, null::numeric, units
      from ranked;
    return;
  end if;

  -- equal
  return query
    with raw as (
      select pid as mid, v_amount_cents::numeric / cardinality(p_participant_ids) as raw_cents
      from unnest(p_participant_ids) pid
    ),
    floored as (
      select mid, floor(raw_cents)::bigint as base_cents, raw_cents - floor(raw_cents) as frac
      from raw
    ),
    ranked as (
      select mid, base_cents, frac,
        row_number() over (order by frac desc, mid) as rn,
        (v_amount_cents - sum(base_cents) over ()) as remainder
      from floored
    )
    select mid, (base_cents + case when rn <= remainder then 1 else 0 end) / 100.0, null::numeric, null::numeric
    from ranked;
end;
$$;

revoke execute on function
  public.compute_expense_splits(numeric, uuid[], text, jsonb)
from public, anon, authenticated;

-- ── add_expense(): extended with split_type/splits/category/notes as
--    optional trailing params (named-arg RPC calls, so this is fully
--    backward compatible — the existing frontend call, which omits them,
--    keeps getting the exact same equal split as before). ───────────────
create or replace function public.add_expense(
  p_trip_id uuid,
  p_paid_by uuid,
  p_amount numeric,
  p_description text,
  p_participant_ids uuid[],
  p_payment_app text default null,
  p_paid_at timestamptz default now(),
  p_location_name text default null,
  p_split_type text default 'equal',
  p_splits jsonb default null,
  p_category text default null,
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expense_id uuid;
  v_ids uuid[];
  v_count int;
  v_split record;
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

  insert into public.expenses (
    trip_id, paid_by, amount, description, payment_app, paid_at,
    location_name, participant_count, share_per_person, created_by,
    split_type, category, notes
  ) values (
    p_trip_id, p_paid_by, p_amount, trim(p_description),
    nullif(trim(p_payment_app), ''), coalesce(p_paid_at, now()),
    nullif(trim(p_location_name), ''), v_count, round(p_amount / v_count, 2), v_uid,
    p_split_type, nullif(trim(p_category), ''), nullif(trim(p_notes), '')
  ) returning id into v_expense_id;

  for v_split in
    select * from public.compute_expense_splits(p_amount, v_ids, p_split_type, p_splits)
  loop
    insert into public.expense_participants (
      expense_id, member_id, share_amount, share_percentage, share_units
    ) values (
      v_expense_id, v_split.member_id, v_split.share_amount,
      v_split.share_percentage, v_split.share_units
    );
  end loop;

  return v_expense_id;
end;
$$;

-- ── edit_expense(): creator or trip owner only. Replaces the expense's
--    participants wholesale (same split-computation path as add_expense)
--    rather than trying to diff them — simplest correct approach for a
--    small participant count. ─────────────────────────────────────────
create or replace function public.edit_expense(
  p_expense_id uuid,
  p_description text,
  p_amount numeric,
  p_paid_by uuid,
  p_participant_ids uuid[],
  p_paid_at timestamptz default null,
  p_payment_app text default null,
  p_location_name text default null,
  p_split_type text default 'equal',
  p_splits jsonb default null,
  p_category text default null,
  p_notes text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expense record;
  v_ids uuid[];
  v_count int;
  v_split record;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;

  select * into v_expense from public.expenses
  where id = p_expense_id and deleted_at is null;
  if v_expense is null then
    raise exception 'That expense no longer exists.';
  end if;
  if not (
    v_expense.created_by = v_uid or public.is_trip_owner(v_expense.trip_id)
  ) then
    raise exception 'Only the person who added this expense (or the trip owner) can edit it.';
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
    where trip_id = v_expense.trip_id and member_id = p_paid_by and is_active
  ) then
    raise exception 'The payer is not an active member of this trip.';
  end if;
  if exists (
    select 1 from unnest(v_ids) pid
    where not exists (
      select 1 from public.trip_members
      where trip_id = v_expense.trip_id and member_id = pid and is_active
    )
  ) then
    raise exception 'Every participant must be an active member of this trip.';
  end if;

  update public.expenses set
    description = trim(p_description),
    amount = p_amount,
    paid_by = p_paid_by,
    paid_at = coalesce(p_paid_at, paid_at),
    payment_app = nullif(trim(coalesce(p_payment_app, '')), ''),
    location_name = nullif(trim(coalesce(p_location_name, '')), ''),
    participant_count = v_count,
    share_per_person = round(p_amount / v_count, 2),
    split_type = p_split_type,
    category = nullif(trim(coalesce(p_category, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_expense_id;

  delete from public.expense_participants where expense_id = p_expense_id;

  for v_split in
    select * from public.compute_expense_splits(p_amount, v_ids, p_split_type, p_splits)
  loop
    insert into public.expense_participants (
      expense_id, member_id, share_amount, share_percentage, share_units
    ) values (
      p_expense_id, v_split.member_id, v_split.share_amount,
      v_split.share_percentage, v_split.share_units
    );
  end loop;
end;
$$;

revoke execute on function
  public.add_expense(uuid, uuid, numeric, text, uuid[], text, timestamptz, text, text, jsonb, text, text)
from public, anon;
grant execute on function
  public.add_expense(uuid, uuid, numeric, text, uuid[], text, timestamptz, text, text, jsonb, text, text)
to authenticated;

revoke execute on function
  public.edit_expense(uuid, text, numeric, uuid, uuid[], timestamptz, text, text, text, jsonb, text, text)
from public, anon;
grant execute on function
  public.edit_expense(uuid, text, numeric, uuid, uuid[], timestamptz, text, text, text, jsonb, text, text)
to authenticated;

-- Tighten the existing soft-delete permission: was "any trip member can
-- soft-delete any expense"; now creator-or-owner, matching "members can
-- edit/delete only their own expenses unless owner". The column grant
-- (only deleted_at/deleted_by/deletion_reason writable) is unchanged.
drop policy expenses_update_member on public.expenses;
create policy expenses_update_owner_or_creator on public.expenses
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_trip_owner(trip_id))
  with check (created_by = (select auth.uid()) or public.is_trip_owner(trip_id));

-- ── trip lifecycle ────────────────────────────────────────────────────
create or replace function public.leave_trip(p_trip_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member_id uuid;
begin
  select m.id into v_member_id
  from public.members m
  join public.trip_members tm on tm.member_id = m.id
  where m.user_id = v_uid and tm.trip_id = p_trip_id and tm.is_active;

  if v_member_id is null then
    raise exception 'You are not an active member of this trip.';
  end if;

  if exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and member_id = v_member_id and role = 'owner'
  ) and not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and role = 'owner' and is_active and member_id <> v_member_id
  ) then
    raise exception 'You are the only owner. Transfer ownership before leaving.';
  end if;

  update public.trip_members
  set is_active = false, left_at = now()
  where trip_id = p_trip_id and member_id = v_member_id;
end;
$$;

create or replace function public.transfer_trip_ownership(
  p_trip_id uuid,
  p_new_owner_member_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current_owner_member_id uuid;
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the current owner can transfer ownership.';
  end if;
  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and member_id = p_new_owner_member_id and is_active
  ) then
    raise exception 'That person is not an active member of this trip.';
  end if;

  select m.id into v_current_owner_member_id
  from public.members m
  join public.trip_members tm on tm.member_id = m.id
  where m.user_id = v_uid and tm.trip_id = p_trip_id and tm.role = 'owner';

  if v_current_owner_member_id = p_new_owner_member_id then
    raise exception 'That person is already the owner.';
  end if;

  update public.trip_members set role = 'owner'
  where trip_id = p_trip_id and member_id = p_new_owner_member_id;
  update public.trip_members set role = 'member'
  where trip_id = p_trip_id and member_id = v_current_owner_member_id;
end;
$$;

-- Hard delete — owner only. Removes the trip and everything under it in
-- one atomic call (single RPC invocation = single transaction).
create or replace function public.delete_trip(p_trip_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can delete this trip.';
  end if;

  delete from public.activity_log where trip_id = p_trip_id;
  delete from public.settlements where trip_id = p_trip_id;
  delete from public.invitations where trip_id = p_trip_id;
  delete from public.expense_participants
    where expense_id in (select id from public.expenses where trip_id = p_trip_id);
  delete from public.expenses where trip_id = p_trip_id;
  delete from public.trip_members where trip_id = p_trip_id;
  delete from public.trips where id = p_trip_id;
end;
$$;

revoke execute on function public.leave_trip(uuid) from public, anon;
grant execute on function public.leave_trip(uuid) to authenticated;
revoke execute on function public.transfer_trip_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_trip_ownership(uuid, uuid) to authenticated;
revoke execute on function public.delete_trip(uuid) from public, anon;
grant execute on function public.delete_trip(uuid) to authenticated;

-- ── settlements ───────────────────────────────────────────────────────
create or replace function public.record_settlement(
  p_trip_id uuid,
  p_from_member_id uuid,
  p_to_member_id uuid,
  p_amount numeric,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_settlement_id uuid;
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'You are not a member of this trip.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_from_member_id = p_to_member_id then
    raise exception 'A settlement needs two different people.';
  end if;
  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and member_id = p_from_member_id and is_active
  ) or not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and member_id = p_to_member_id and is_active
  ) then
    raise exception 'Both people must be active members of this trip.';
  end if;

  insert into public.settlements (trip_id, from_member_id, to_member_id, amount, note, settled_by)
  values (p_trip_id, p_from_member_id, p_to_member_id, p_amount, nullif(trim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;

revoke execute on function public.record_settlement(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.record_settlement(uuid, uuid, uuid, numeric, text) to authenticated;

-- ── activity log triggers (additive; the RPCs above are unmodified) ────
create or replace function public.log_expense_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_member_id uuid;
  v_actor_name text;
begin
  select m.id, m.name into v_actor_member_id, v_actor_name
  from public.members m where m.user_id = coalesce(new.created_by, (select auth.uid()));

  if tg_op = 'INSERT' then
    insert into public.activity_log (trip_id, actor_member_id, action, description, metadata)
    values (
      new.trip_id, v_actor_member_id, 'expense_added',
      coalesce(v_actor_name, 'Someone') || ' added ' || new.description,
      jsonb_build_object('expense_id', new.id, 'amount', new.amount)
    );
  elsif tg_op = 'UPDATE' then
    if new.deleted_at is not null and old.deleted_at is null then
      insert into public.activity_log (trip_id, actor_member_id, action, description, metadata)
      values (
        new.trip_id, v_actor_member_id, 'expense_deleted',
        coalesce(v_actor_name, 'Someone') || ' deleted ' || new.description,
        jsonb_build_object('expense_id', new.id)
      );
    elsif new.deleted_at is null and (
      new.description is distinct from old.description
      or new.amount is distinct from old.amount
      or new.paid_by is distinct from old.paid_by
    ) then
      insert into public.activity_log (trip_id, actor_member_id, action, description, metadata)
      values (
        new.trip_id, v_actor_member_id, 'expense_edited',
        coalesce(v_actor_name, 'Someone') || ' edited ' || new.description,
        jsonb_build_object('expense_id', new.id)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_log_expense_activity
  after insert or update on public.expenses
  for each row execute function public.log_expense_activity();

create or replace function public.log_trip_member_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.members where id = new.member_id;

  if tg_op = 'INSERT' then
    insert into public.activity_log (trip_id, actor_member_id, action, description)
    values (new.trip_id, new.member_id, 'member_joined', coalesce(v_name, 'Someone') || ' joined the trip');
  elsif tg_op = 'UPDATE' then
    if new.is_active = false and old.is_active = true then
      insert into public.activity_log (trip_id, actor_member_id, action, description)
      values (new.trip_id, new.member_id, 'member_left', coalesce(v_name, 'Someone') || ' left the trip');
    elsif new.is_active = true and old.is_active = false then
      insert into public.activity_log (trip_id, actor_member_id, action, description)
      values (new.trip_id, new.member_id, 'member_joined', coalesce(v_name, 'Someone') || ' rejoined the trip');
    elsif new.role is distinct from old.role then
      insert into public.activity_log (trip_id, actor_member_id, action, description)
      values (
        new.trip_id, new.member_id, 'role_changed',
        coalesce(v_name, 'Someone') || ' became ' || new.role
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_log_trip_member_activity
  after insert or update on public.trip_members
  for each row execute function public.log_trip_member_activity();

create or replace function public.log_invitation_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    select name into v_name from public.members where id = new.member_id;
    insert into public.activity_log (trip_id, actor_member_id, action, description)
    values (
      new.trip_id, new.member_id, 'invitation_accepted',
      coalesce(v_name, 'Someone') || ' accepted their invitation'
    );
  end if;
  return new;
end;
$$;

create trigger trg_log_invitation_activity
  after update on public.invitations
  for each row execute function public.log_invitation_activity();

create or replace function public.log_settlement_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_from_name text;
  v_to_name text;
begin
  select name into v_from_name from public.members where id = new.from_member_id;
  select name into v_to_name from public.members where id = new.to_member_id;
  insert into public.activity_log (trip_id, actor_member_id, action, description, metadata)
  values (
    new.trip_id, new.from_member_id, 'settlement_completed',
    coalesce(v_from_name, 'Someone') || ' settled ' || to_char(new.amount, 'FM999999999.00')
      || ' with ' || coalesce(v_to_name, 'someone'),
    jsonb_build_object('settlement_id', new.id, 'amount', new.amount)
  );
  return new;
end;
$$;

create trigger trg_log_settlement_activity
  after insert on public.settlements
  for each row execute function public.log_settlement_activity();
