
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_business_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_user(uuid) TO authenticated, service_role;
