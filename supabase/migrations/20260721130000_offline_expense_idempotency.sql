-- Offline expense queue: idempotency for the sync endpoint.
--
-- Additive only from a data-model standpoint: `offline_idempotency_key` is
-- a new nullable column, and the partial unique index only ever constrains
-- rows created through the offline sync path (key is null for every normal
-- online expense) — no existing row or online call site's *behavior*
-- changes.
--
-- IMPORTANT — corrected after applying to the live project: appending a new
-- parameter to `add_expense()`, even with a default, changes its argument
-- signature. `CREATE OR REPLACE FUNCTION` does *not* replace an existing
-- function across a signature change — Postgres treats it as a distinct
-- function and creates a second overload instead (confirmed live: this
-- produced two coexisting `add_expense` functions). A brand-new function
-- object also does not inherit the old one's grants — it gets Postgres's
-- schema default, which on this project turned out to include `anon`
-- (evidently via a default-privilege rule that predates the Stage 2 RLS
-- hardening pass, which only revoked grants on *existing* objects, not
-- future ones). Neither issue was a live exploit — `add_expense()` still
-- checks `auth.uid()` internally and rejects unauthenticated callers
-- regardless of the outer grant — but both are wrong and are fixed here:
-- the old 16-parameter overload is dropped so only one `add_expense`
-- exists, and its grants are set back explicitly to match the original
-- function exactly (authenticated + service_role + postgres, nothing
-- else). This file reflects the corrected, reproducible sequence — not the
-- first (wrong) attempt.

alter table public.expenses
  add column if not exists offline_idempotency_key uuid;

-- Partial unique index: only constrains rows that actually came through
-- the offline sync path, scoped per-creator so two different users can
-- never collide even in the astronomically unlikely event of a client-side
-- UUID collision.
create unique index if not exists expenses_offline_idempotency_key_idx
  on public.expenses (created_by, offline_idempotency_key)
  where offline_idempotency_key is not null;

drop function if exists public.add_expense(
  uuid, uuid, numeric, text, uuid[], text, timestamp with time zone,
  text, text, jsonb, text, text, numeric, numeric, text, text
);

create function public.add_expense(
  p_trip_id uuid,
  p_paid_by uuid,
  p_amount numeric,
  p_description text,
  p_participant_ids uuid[],
  p_payment_app text default null::text,
  p_paid_at timestamp with time zone default now(),
  p_location_name text default null::text,
  p_split_type text default 'equal'::text,
  p_splits jsonb default null::jsonb,
  p_category text default null::text,
  p_notes text default null::text,
  p_latitude numeric default null::numeric,
  p_longitude numeric default null::numeric,
  p_location_place_id text default null::text,
  p_location_formatted_address text default null::text,
  p_offline_idempotency_key uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_expense_id uuid;
  v_ids uuid[];
  v_count int;
  v_split record;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;

  -- Idempotent replay: a retried offline-sync request for an expense that
  -- already made it to the server returns the existing row instead of
  -- creating a duplicate. Scoped to this caller's own rows only.
  if p_offline_idempotency_key is not null then
    select id into v_expense_id
    from public.expenses
    where created_by = v_uid and offline_idempotency_key = p_offline_idempotency_key
    limit 1;
    if v_expense_id is not null then
      return v_expense_id;
    end if;
  end if;

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
    latitude, longitude, location_place_id, location_formatted_address,
    offline_idempotency_key
  ) values (
    p_trip_id, p_paid_by, p_amount, trim(p_description),
    nullif(trim(p_payment_app), ''), coalesce(p_paid_at, now()),
    nullif(trim(p_location_name), ''), v_count, round(p_amount / v_count, 2), v_uid,
    p_split_type, nullif(trim(p_category), ''), nullif(trim(p_notes), ''),
    p_latitude, p_longitude, nullif(trim(p_location_place_id), ''),
    nullif(trim(p_location_formatted_address), ''),
    p_offline_idempotency_key
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
$function$;

-- A brand-new function object always gets the schema's default grants —
-- explicitly set them back to exactly what the original function had.
revoke all on function public.add_expense(
  uuid, uuid, numeric, text, uuid[], text, timestamp with time zone,
  text, text, jsonb, text, text, numeric, numeric, text, text, uuid
) from public, anon;

grant execute on function public.add_expense(
  uuid, uuid, numeric, text, uuid[], text, timestamp with time zone,
  text, text, jsonb, text, text, numeric, numeric, text, text, uuid
) to authenticated, service_role, postgres;
