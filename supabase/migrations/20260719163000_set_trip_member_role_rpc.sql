-- Owner-only role management. Promoting is unrestricted; demoting is blocked
-- when it would leave the trip with no active owner (explicit transfer:
-- promote the other person first, then demote yourself).
create or replace function public.set_trip_member_role(
  p_trip_id uuid,
  p_member_id uuid,
  p_role text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can change roles.';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member.';
  end if;
  if p_role = 'member' and not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and role = 'owner' and is_active
      and member_id <> p_member_id
  ) then
    raise exception 'A trip must keep at least one owner. Promote someone else first.';
  end if;

  update public.trip_members
  set role = p_role
  where trip_id = p_trip_id and member_id = p_member_id and is_active;

  if not found then
    raise exception 'That member is not an active member of this trip.';
  end if;
end;
$$;

revoke execute on function public.set_trip_member_role(uuid, uuid, text)
  from public, anon;
grant execute on function public.set_trip_member_role(uuid, uuid, text)
  to authenticated;
