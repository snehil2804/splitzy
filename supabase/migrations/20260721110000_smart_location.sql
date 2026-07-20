-- Smart Location: store both a concise human-readable place name and
-- precise machine-readable location data on each expense, so future
-- features (expense map, location history, nearby-expense grouping,
-- travel analytics) never need to re-geocode anything.
--
-- `location_name` already exists and stays the single source of truth for
-- "what to show" (the concise place name, e.g. "Blue Tokai Coffee") — not
-- duplicated as a separate display_name column, per instruction to reuse
-- existing fields rather than duplicate information. `latitude`/
-- `longitude` already exist too, but the ID-based add_expense()/
-- edit_expense() RPCs never actually accepted them (only the legacy
-- name-based add_equal_expense() did) — fixed here, alongside the two
-- genuinely new columns needed for the Places-API side of this feature.
alter table public.expenses
  add column if not exists location_place_id text,
  add column if not exists location_formatted_address text;

comment on column public.expenses.location_name is
  'Concise, human-friendly place name shown throughout the UI (e.g. "Blue Tokai Coffee"). Populated by Smart Location autocomplete/nearby-search, or typed manually.';
comment on column public.expenses.location_formatted_address is
  'Full address as returned by the Places API, stored for reference/future features — never shown as the primary label.';
comment on column public.expenses.location_place_id is
  'Google Places place_id, when the location was picked from a Places search/autocomplete/nearby result. Null for manually typed locations.';

-- add_expense(): gains p_latitude/p_longitude/p_location_place_id/
-- p_location_formatted_address. A changed parameter list via
-- `create or replace` creates a NEW overload rather than replacing the
-- old one (hit and fixed once already, in the Stage 3 hardening
-- migration) — drop the old signature first this time, function body
-- otherwise unchanged from the Stage 3 version.
drop function if exists public.add_expense(
  uuid, uuid, numeric, text, uuid[], text, timestamptz, text, text, jsonb, text, text
);

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
  p_notes text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_location_place_id text default null,
  p_location_formatted_address text default null
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
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'Longitude must be between -180 and 180.';
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
    split_type, category, notes,
    latitude, longitude, location_place_id, location_formatted_address
  ) values (
    p_trip_id, p_paid_by, p_amount, trim(p_description),
    nullif(trim(p_payment_app), ''), coalesce(p_paid_at, now()),
    nullif(trim(p_location_name), ''), v_count, round(p_amount / v_count, 2), v_uid,
    p_split_type, nullif(trim(p_category), ''), nullif(trim(p_notes), ''),
    p_latitude, p_longitude, nullif(trim(p_location_place_id), ''),
    nullif(trim(p_location_formatted_address), '')
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

-- edit_expense(): same additions, same drop-before-recreate reasoning.
drop function if exists public.edit_expense(
  uuid, text, numeric, uuid, uuid[], timestamptz, text, text, text, jsonb, text, text
);

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
  p_notes text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_location_place_id text default null,
  p_location_formatted_address text default null
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
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'Longitude must be between -180 and 180.';
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
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    latitude = p_latitude,
    longitude = p_longitude,
    location_place_id = nullif(trim(coalesce(p_location_place_id, '')), ''),
    location_formatted_address = nullif(trim(coalesce(p_location_formatted_address, '')), '')
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
