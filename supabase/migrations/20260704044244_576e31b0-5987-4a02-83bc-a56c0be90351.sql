
DROP POLICY IF EXISTS "auth insert logs" ON public.activity_logs;
CREATE POLICY "auth insert logs" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (
      is_super_admin()
      OR tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS "Anyone authenticated can view plans" ON public.subscription_plans;
CREATE POLICY "Authenticated can view active plans" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS "read settings" ON public.system_settings;
CREATE POLICY "sa read settings" ON public.system_settings
  FOR SELECT TO authenticated
  USING (is_super_admin());
