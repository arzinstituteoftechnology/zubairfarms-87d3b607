REVOKE EXECUTE ON FUNCTION public.enforce_current_tenant_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_current_tenant_id() TO service_role;