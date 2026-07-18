
-- 1) system_settings: remove broad authenticated SELECT; expose only module flags via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Authenticated can read system settings" ON public.system_settings;

CREATE OR REPLACE FUNCTION public.get_module_flags()
RETURNS TABLE(customers_module_enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(customers_module_enabled, false)
  FROM public.system_settings
  WHERE id = 1
$$;

REVOKE ALL ON FUNCTION public.get_module_flags() FROM public;
GRANT EXECUTE ON FUNCTION public.get_module_flags() TO authenticated;

-- 2) role_permissions: table is intentionally global (permission templates by role name, no tenant_id).
-- Replace ambiguous policy with an explicit authenticated read policy, documenting it as global config.
DROP POLICY IF EXISTS "Users can read their own role permissions" ON public.role_permissions;

CREATE POLICY "Authenticated can read global role permission templates"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

COMMENT ON TABLE public.role_permissions IS
  'Global permission templates keyed by role name. Not tenant-scoped by design; readable by all authenticated users, writable only by super admins.';
