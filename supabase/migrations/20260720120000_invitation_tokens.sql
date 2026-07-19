-- Stage 2 (feature/invitations): shareable invite links. Additive only —
-- no existing rows touched (0 rows in `invitations` today).

-- email becomes optional: the token is now the primary claim mechanism;
-- email stays as an optional secondary auto-claim-on-login path. The
-- existing check constraint already passes on NULL (Postgres CHECK treats
-- NULL as satisfied), so only the NOT NULL needs dropping.
alter table public.invitations alter column email drop not null;

alter table public.invitations
  add column token text not null unique
    default encode(extensions.gen_random_bytes(24), 'hex'),
  add column expires_at timestamptz not null default (now() + interval '7 days'),
  add column accepted_by uuid references auth.users(id);

create index idx_invitations_token on public.invitations (token);

-- ── invite_member(): now member-first (a specific member UUID is always
--    the target, matching "invitation links must always point to a member
--    UUID"), email optional, returns the token so the caller can build the
--    share link immediately. Return type changes (uuid -> text), so the
--    old signature must be dropped first. ─────────────────────────────────
drop function if exists public.invite_member(uuid, text, uuid, text);

create or replace function public.invite_member(
  p_trip_id uuid,
  p_member_id uuid,
  p_email text default null,
  p_role text default 'member'
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can invite members.';
  end if;
  if p_member_id is null then
    raise exception 'A member to invite is required.';
  end if;
  if p_email is not null and position('@' in p_email) <= 1 then
    raise exception 'That email address looks invalid.';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member.';
  end if;
  if not exists (
    select 1 from public.trip_members tm
    join public.members m on m.id = tm.member_id
    where tm.trip_id = p_trip_id and tm.member_id = p_member_id
      and m.user_id is null
  ) then
    raise exception 'That member is not an unclaimed member of this trip.';
  end if;

  begin
    insert into public.invitations (trip_id, email, member_id, role, invited_by)
    values (
      p_trip_id,
      nullif(lower(trim(coalesce(p_email, ''))), ''),
      p_member_id,
      p_role,
      v_uid
    )
    returning token into v_token;
  exception when unique_violation then
    raise exception 'That email already has a pending invitation to this trip.';
  end;

  return v_token;
end;
$$;

revoke execute on function public.invite_member(uuid, uuid, text, text) from public, anon;
grant execute on function public.invite_member(uuid, uuid, text, text) to authenticated;

-- ── preview_invitation(): the one place `anon` gets a grant again, and
--    deliberately so — a link recipient must see who/what they're joining
--    before signing in. Narrow surface: only trip/member *names* and
--    validity flags for a token the caller already possesses, nothing else
--    from the row (no trip_id, no email, no other members). ───────────────
create or replace function public.preview_invitation(p_token text)
returns table (
  trip_name text,
  member_name text,
  is_valid boolean
)
language sql stable security definer set search_path = ''
as $$
  select
    t.name,
    m.name,
    (i.status = 'pending' and i.expires_at > now() and m.user_id is null)
  from public.invitations i
  join public.trips t on t.id = i.trip_id
  join public.members m on m.id = i.member_id
  where i.token = p_token;
$$;

revoke execute on function public.preview_invitation(text) from public;
grant execute on function public.preview_invitation(text) to anon, authenticated;

-- ── claim_invitation(): the explicit "recipient opens link, logs in,
--    claims" path. Authenticated-only; token is the sole credential (not
--    email), so the caller may be signed in with any email. Guards: token
--    must be pending + unexpired; target member must still be unclaimed;
--    caller must not already be linked to a *different* member (members
--    .user_id is globally unique — one auth identity, one member, ever).
--    Claim + trip join happen atomically in one function call. ───────────
create or replace function public.claim_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv record;
  v_existing_member uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_inv
  from public.invitations
  where token = p_token and status = 'pending'
  for update;

  if v_inv is null then
    raise exception 'This invite link is invalid or has already been used.';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invite link has expired.';
  end if;

  select id into v_existing_member from public.members where user_id = v_uid;
  if v_existing_member is not null and v_existing_member <> v_inv.member_id then
    raise exception 'Your account is already linked to a different member.';
  end if;

  update public.members set user_id = v_uid
  where id = v_inv.member_id and user_id is null;
  if not found then
    raise exception 'That member has already been claimed by someone else.';
  end if;

  update public.trip_members
  set is_active = true, left_at = null,
      role = public.greatest_role(role, v_inv.role)
  where trip_id = v_inv.trip_id and member_id = v_inv.member_id;

  if not found then
    insert into public.trip_members (trip_id, member_id, role)
    values (v_inv.trip_id, v_inv.member_id, v_inv.role);
  end if;

  update public.invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  return v_inv.trip_id;
end;
$$;

revoke execute on function public.claim_invitation(text) from public, anon;
grant execute on function public.claim_invitation(text) to authenticated;
