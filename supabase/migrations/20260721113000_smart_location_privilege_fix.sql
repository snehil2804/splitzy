-- The drop-then-recreate of add_expense()/edit_expense() in the
-- smart_location migration (required to change their parameter list)
-- dropped the function objects entirely, which also drops their ACL
-- grants — so the new signatures silently fell back to Postgres's default
-- (EXECUTE granted to PUBLIC, including anon) instead of keeping the
-- original migration's explicit authenticated-only grant. Not actively
-- exploitable (both functions still reject anon immediately via
-- `auth.uid() is null`), but restore the intended grant to close the gap.
revoke execute on function
  public.add_expense(uuid, uuid, numeric, text, uuid[], text, timestamptz, text, text, jsonb, text, text, numeric, numeric, text, text)
from public, anon;
grant execute on function
  public.add_expense(uuid, uuid, numeric, text, uuid[], text, timestamptz, text, text, jsonb, text, text, numeric, numeric, text, text)
to authenticated;

revoke execute on function
  public.edit_expense(uuid, text, numeric, uuid, uuid[], timestamptz, text, text, text, jsonb, text, text, numeric, numeric, text, text)
from public, anon;
grant execute on function
  public.edit_expense(uuid, text, numeric, uuid, uuid[], timestamptz, text, text, text, jsonb, text, text, numeric, numeric, text, text)
to authenticated;
