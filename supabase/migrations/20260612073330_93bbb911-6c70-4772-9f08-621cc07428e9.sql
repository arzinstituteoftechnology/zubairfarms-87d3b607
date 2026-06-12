
-- ===== AUDIT FIX MIGRATION =====
-- 1. Foreign keys for tenant_id on every business table
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'farms','shops','customers','suppliers','purchases','supplies','expenses',
    'trucks','deliveries','pos_sales','pos_sale_items','customer_payments',
    'farm_payments','settings','activity_logs','payments','subscriptions','tenant_users'
  ]) LOOP
    -- skip suppliers if missing
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu USING(constraint_name)
          WHERE tc.table_schema='public' AND tc.table_name=t
            AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='tenant_id'
        ) THEN
          EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE', t, t||'_tenant_id_fkey');
        END IF;
      END IF;
    END IF;
  END LOOP;
END$$;

-- 2. Missing indexes
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON public.payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON public.subscriptions(tenant_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant ON public.activity_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(status);

-- 3. Enforce one tenant per user (current_tenant_id() assumes this)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='tenant_users_user_unique') THEN
    -- only if no duplicates exist
    IF NOT EXISTS (SELECT user_id FROM public.tenant_users GROUP BY user_id HAVING count(*)>1) THEN
      CREATE UNIQUE INDEX tenant_users_user_unique ON public.tenant_users(user_id);
    END IF;
  END IF;
END $$;

-- 4. Active-subscription gate function (DB-level subscription enforcement)
CREATE OR REPLACE FUNCTION public.tenant_has_active_subscription(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    JOIN public.tenants t ON t.id = s.tenant_id
    WHERE s.tenant_id = _tenant_id
      AND t.status = 'active'
      AND s.status IN ('active','trial')
      AND s.expires_at > now()
  )
$$;
REVOKE EXECUTE ON FUNCTION public.tenant_has_active_subscription(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_has_active_subscription(uuid) TO authenticated, service_role;

-- 5. Rewrite ERP RLS to also require active subscription (super admin bypass preserved)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'farms','shops','customers','purchases','supplies','expenses','trucks',
    'deliveries','pos_sales','pos_sale_items','customer_payments','farm_payments','settings'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "tenant all %s" ON public.%I', t, t);
      EXECUTE format($f$CREATE POLICY "tenant all %s" ON public.%I FOR ALL TO authenticated
        USING (is_super_admin() OR (tenant_id = current_tenant_id() AND tenant_has_active_subscription(tenant_id)))
        WITH CHECK (is_super_admin() OR (tenant_id = current_tenant_id() AND tenant_has_active_subscription(tenant_id)))$f$, t, t);
    END IF;
  END LOOP;
END$$;

-- 6. Restrict publicly-readable tables to authenticated
DROP POLICY IF EXISTS "read plans" ON public.subscription_plans;
CREATE POLICY "read plans" ON public.subscription_plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "read settings" ON public.system_settings;
CREATE POLICY "read settings" ON public.system_settings FOR SELECT TO authenticated USING (true);

-- 7. Tighten activity_logs insert: enforce actor and tenant scope
DROP POLICY IF EXISTS "auth insert logs" ON public.activity_logs;
CREATE POLICY "auth insert logs" ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (tenant_id IS NULL OR tenant_id = current_tenant_id() OR is_super_admin())
  );

-- 8. Lock down bootstrap_super_admin from anon (no-op after first SA, but still)
REVOKE EXECUTE ON FUNCTION public.bootstrap_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin() TO authenticated;

-- 9. Ensure GRANTs on every public table that policies expect
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_users TO authenticated;
GRANT ALL ON public.tenant_users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_plans TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
