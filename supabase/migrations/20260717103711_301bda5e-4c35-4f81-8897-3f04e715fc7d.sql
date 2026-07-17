-- Restrict activity_logs SELECT to tenant owners/managers (plus super admin).
-- Rank-and-file tenant members no longer see full audit history.

CREATE OR REPLACE FUNCTION public.is_tenant_manager_or_owner(_uid uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_users
    WHERE user_id = _uid
      AND tenant_id = _tenant_id
      AND tenant_role IN ('owner', 'manager')
  );
$$;

REVOKE ALL ON FUNCTION public.is_tenant_manager_or_owner(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager_or_owner(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "tenant read own logs" ON public.activity_logs;

CREATE POLICY "owners/managers read tenant logs"
ON public.activity_logs
FOR SELECT
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND tenant_has_active_subscription(tenant_id)
  AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)
);
