
-- 1) Restrict role_permissions SELECT to the caller's own role (owner/super_admin keep full access via ALL policy)
DROP POLICY IF EXISTS "Authenticated can read role permissions" ON public.role_permissions;

CREATE POLICY "Users can read their own role permissions"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_tenant_owner(auth.uid())
  OR role = (
    SELECT tenant_role::text FROM public.tenant_users
    WHERE user_id = auth.uid() AND status = 'active'
    LIMIT 1
  )
);

-- 2) Set a stable search_path on activity_logs_append_only
CREATE OR REPLACE FUNCTION public.activity_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'activity_logs is append-only; % is not allowed', TG_OP USING ERRCODE = '42501';
END;
$function$;
