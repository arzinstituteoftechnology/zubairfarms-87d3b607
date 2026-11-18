DROP POLICY IF EXISTS "Authenticated can read global role permission templates" ON public.role_permissions;
CREATE POLICY "Business users and super admins can read role permission templates"
ON public.role_permissions FOR SELECT TO authenticated
USING (public.is_super_admin() OR public.is_business_user(auth.uid()));