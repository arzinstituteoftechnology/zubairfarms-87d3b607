
-- Fix 1: role_permissions is a global template table (no tenant_id).
-- Prevent any owner from mutating global defaults; only super_admin may write.
-- Tenant-specific customization already lives in role_templates.
DROP POLICY IF EXISTS "Owners can manage role permissions" ON public.role_permissions;

CREATE POLICY "Super admin can manage role permissions"
ON public.role_permissions
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Fix 2: system_settings holds app-wide config (app_name, currency, module flags)
-- that the frontend reads for every authenticated user (see useModuleFlags).
-- Add a read-only policy for authenticated users; writes remain super_admin only.
CREATE POLICY "Authenticated can read system settings"
ON public.system_settings
FOR SELECT
TO authenticated
USING (true);
