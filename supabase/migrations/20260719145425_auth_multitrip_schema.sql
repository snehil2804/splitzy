-- Stage 2 (feature/auth-multi-trip): additive schema for authenticated
-- multi-trip. No existing rows are inserted, updated, or deleted.

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── additive columns ────────────────────────────────────────────────────────
-- members.user_id: which auth user this member identity belongs to.
-- NULL = guest member (exists in trips but has no login).
alter table public.members
  add column user_id uuid unique references auth.users(id);

alter table public.trips
  add column created_by uuid references auth.users(id);

alter table public.trip_members
  add column role text not null default 'member'
    check (role in ('owner', 'member')),
  add column is_active boolean not null default true,
  add column left_at timestamptz;

alter table public.expenses
  add column created_by uuid references auth.users(id);

-- Widen the participant cap (was 1..3) — trips can now have any number of
-- members. Purely widening: every existing row (1..3) still satisfies >= 1.
alter table public.expenses
  drop constraint expenses_valid_participant_count;
alter table public.expenses
  add constraint expenses_valid_participant_count check (participant_count >= 1);

-- ── invitations ─────────────────────────────────────────────────────────────
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  email text not null check (position('@' in email) > 1),
  -- Optional: an existing guest member this invite should claim on accept,
  -- so pre-auth members (Snehil/Shruti/Anshul) keep their IDs and history.
  member_id uuid references public.members(id),
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index invitations_unique_pending
  on public.invitations (trip_id, lower(email)) where status = 'pending';
create index idx_invitations_email on public.invitations (lower(email));
create index idx_invitations_trip_id on public.invitations (trip_id);
create index idx_members_user_id on public.members (user_id);

-- ── membership helpers (security definer: bypass RLS internally, so
--    policies can use them without recursive policy evaluation) ─────────────
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members tm
    join public.members m on m.id = tm.member_id
    where tm.trip_id = p_trip_id
      and tm.is_active
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_trip_owner(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members tm
    join public.members m on m.id = tm.member_id
    where tm.trip_id = p_trip_id
      and tm.is_active
      and tm.role = 'owner'
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_expense_member(p_expense_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_trip_member(e.trip_id)
  from public.expenses e
  where e.id = p_expense_id;
$$;

revoke execute on function public.is_trip_member(uuid),
  public.is_trip_owner(uuid), public.is_expense_member(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid),
  public.is_trip_owner(uuid), public.is_expense_member(uuid) to authenticated;

-- Advisor-flagged hardening: the rls_auto_enable event-trigger helper should
-- not be callable through the API by anon/authenticated.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
