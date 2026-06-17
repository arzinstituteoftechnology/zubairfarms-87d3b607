
DROP POLICY IF EXISTS "insert attempts" ON public.super_admin_login_attempts;
REVOKE INSERT ON public.super_admin_login_attempts FROM anon, authenticated;
