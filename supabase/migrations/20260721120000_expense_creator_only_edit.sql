-- Expense Details feature: tighten edit permission from "creator or trip
-- owner" to strictly "creator only". Delete stays "creator or trip owner"
-- (unchanged) — that's still enforced by the existing
-- expenses_update_owner_or_creator RLS policy on the soft-delete columns,
-- which already matches this rule exactly, so it needs no migration.
--
-- Legacy expenses (created_by is null, predating Stage 3's creator
-- tracking) were already excluded from creator-based edit rights before
-- this change (`null = v_uid` is never true) — that behavior is
-- unaffected, they just lose the trip-owner edit escape hatch too now.
-- They remain deletable by the trip owner via the unchanged RLS policy.
--
-- Signature is identical to the live function, so `create or replace`
-- replaces it in place — no drop needed, and (per the lesson from the
-- smart_location migration) no risk of resetting its execute grant, since
-- that only happens when the parameter list changes.
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
  if v_expense.created_by is null or v_expense.created_by <> v_uid then
    raise exception 'Only the person who logged this expense can edit it.';
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
