
-- 1. Additive columns on backup_history
ALTER TABLE public.backup_history
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS schema_version text;

CREATE INDEX IF NOT EXISTS idx_backup_history_tenant_created
  ON public.backup_history (tenant_id, created_at DESC);

-- 2. tenant_backup_settings table
CREATE TABLE IF NOT EXISTS public.tenant_backup_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  schedule text NOT NULL DEFAULT 'off'
    CHECK (schedule IN ('off','hourly','every_6h','daily','weekly','monthly')),
  retain_backups int NOT NULL DEFAULT 30 CHECK (retain_backups BETWEEN 1 AND 365),
  next_run_at timestamptz,
  last_run_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_backup_settings TO authenticated;
GRANT ALL ON public.tenant_backup_settings TO service_role;

ALTER TABLE public.tenant_backup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manages own tenant backup settings" ON public.tenant_backup_settings;
CREATE POLICY "owner manages own tenant backup settings"
  ON public.tenant_backup_settings
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid()))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid()))
  );

DROP TRIGGER IF EXISTS trg_tenant_backup_settings_touch ON public.tenant_backup_settings;
CREATE TRIGGER trg_tenant_backup_settings_touch
  BEFORE UPDATE ON public.tenant_backup_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Extra SELECT policy for tenant owners on backup_history
DROP POLICY IF EXISTS "tenant owner reads own tenant backups" ON public.backup_history;
CREATE POLICY "tenant owner reads own tenant backups"
  ON public.backup_history
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = public.current_tenant_id()
    AND public.is_tenant_owner(auth.uid())
  );

-- 4. delete_backup RPC (Owner-of-tenant or Super Admin)
CREATE OR REPLACE FUNCTION public.delete_backup(_id uuid, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.backup_history;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _row FROM public.backup_history WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (_row.tenant_id IS NOT NULL
        AND _row.tenant_id = public.current_tenant_id()
        AND public.is_tenant_owner(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Only the account Owner or Super Admin can delete backups' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.backup_history WHERE id = _id;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES (
    'backup_delete',
    'backup_history',
    _id::text,
    _row.tenant_id,
    jsonb_build_object(
      'backup_name', _row.backup_name,
      'backup_type', _row.backup_type,
      'file_size', _row.file_size,
      'storage_path', _row.storage_path,
      'reason', _reason
    ),
    auth.uid()
  );

  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_backup(uuid, text) TO authenticated;
