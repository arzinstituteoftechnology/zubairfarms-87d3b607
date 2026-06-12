-- Restrict SECURITY DEFINER functions to authenticated/service_role only
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_business_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_has_active_subscription(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_has_active_subscription(uuid) TO authenticated, service_role;