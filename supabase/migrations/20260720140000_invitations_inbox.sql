-- Stage 2 enhancement (feature/invitations): surface pending invitations
-- inside the recipient's own account, so an existing user can accept/
-- decline without ever touching the link. Additive; reuses the existing
-- claim_invitation()/RLS/token architecture unchanged — only adds a
-- read (list_my_invitations) and a small write (decline_invitation),
-- both SECURITY DEFINER, both scoped to the caller's own verified email
-- exactly like the existing invitations_select_own RLS policy already is.

alter table public.invitations drop constraint invitations_status_check;
alter table public.invitations
  add constraint invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'declined'));

-- ── list_my_invitations(): everything the Invitations page needs in one
--    call. Trip/member names and the inviter's display name are exposed
--    here (bypassing RLS internally, as preview_invitation() already
--    does for anon) because the invitee legitimately can't read those
--    tables directly before joining the trip. Also returns the token —
--    safe to expose here because this function itself is the same
--    "prove you own this email" gate that /join's preview already
--    relies on; Accept then reuses claim_invitation() unchanged. ───────────
create or replace function public.list_my_invitations()
returns table (
  id uuid,
  token text,
  trip_name text,
  member_name text,
  inviter_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select
    i.id,
    i.token,
    t.name,
    m.name,
    coalesce(nullif(trim(p.display_name), ''), split_part(p.email, '@', 1), 'A trip owner'),
    i.created_at,
    i.expires_at
  from public.invitations i
  join public.trips t on t.id = i.trip_id
  join public.members m on m.id = i.member_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email is not null
    and lower(i.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  order by i.created_at desc;
$$;

revoke execute on function public.list_my_invitations() from public, anon;
grant execute on function public.list_my_invitations() to authenticated;

-- ── decline_invitation(): the recipient's own action, not the owner's —
--    scoped by email match (the same ownership proof list_my_invitations
--    already required to surface it), never by token. Never touches
--    members/trip_members — declining only changes what this one person
--    sees; the member/trip stay exactly as they were. ──────────────────
create or replace function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if v_email = '' then
    raise exception 'You must be signed in.';
  end if;

  update public.invitations
  set status = 'declined'
  where id = p_invitation_id
    and status = 'pending'
    and email is not null
    and lower(email) = v_email;

  if not found then
    raise exception 'That invitation is no longer available.';
  end if;
end;
$$;

revoke execute on function public.decline_invitation(uuid) from public, anon;
grant execute on function public.decline_invitation(uuid) to authenticated;
