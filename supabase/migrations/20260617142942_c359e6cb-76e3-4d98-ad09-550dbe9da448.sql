
-- 1) Supplier ledger entries: require active subscription
DROP POLICY IF EXISTS "Tenant users manage supplier ledger" ON public.supplier_ledger_entries;
CREATE POLICY "Tenant users manage supplier ledger"
  ON public.supplier_ledger_entries
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id = public.current_tenant_id() AND public.tenant_has_active_subscription(tenant_id))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (tenant_id = public.current_tenant_id() AND public.tenant_has_active_subscription(tenant_id))
  );

-- 2) Activity logs: require active subscription for tenant reads
DROP POLICY IF EXISTS "tenant read own logs" ON public.activity_logs;
CREATE POLICY "tenant read own logs"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_active_subscription(tenant_id)
  );

-- 3) Enforce one tenant per user + deterministic current_tenant_id()
ALTER TABLE public.tenant_users
  ADD CONSTRAINT tenant_users_user_id_unique UNIQUE (user_id);

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tenant_id
  FROM public.tenant_users
  WHERE user_id = auth.uid()
  ORDER BY created_at ASC, tenant_id ASC
  LIMIT 1
$function$;
