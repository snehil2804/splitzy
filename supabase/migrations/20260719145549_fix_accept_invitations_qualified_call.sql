-- Fix: greatest_role() must be schema-qualified — accept_my_invitations runs
-- with search_path = '' so the unqualified call would fail at runtime.
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
        role = public.greatest_role(role, v_inv.role)
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
