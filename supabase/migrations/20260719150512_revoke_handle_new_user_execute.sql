-- Hardening (advisor 0028): the profiles trigger function shouldn't be
-- EXECUTE-able via the REST RPC surface. Not exploitable (trigger functions
-- reject direct calls) but revoking removes the lint and the surface.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
