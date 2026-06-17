
-- Backup history
CREATE TABLE IF NOT EXISTS public.backup_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('daily','manual','emergency','pre_restore','monthly')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','warning')),
  storage_path TEXT,
  file_size BIGINT,
  table_counts JSONB,
  health JSONB,
  error_message TEXT,
  email_status TEXT,
  drive_status TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_history TO authenticated;
GRANT ALL ON public.backup_history TO service_role;
ALTER TABLE public.backup_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin manages backup history"
  ON public.backup_history FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE INDEX IF NOT EXISTS idx_backup_history_created_at ON public.backup_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_history_type ON public.backup_history (backup_type);

-- Backup settings (single row, id=1)
CREATE TABLE IF NOT EXISTS public.backup_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  primary_email TEXT,
  secondary_email TEXT,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  drive_enabled BOOLEAN NOT NULL DEFAULT false,
  drive_folder_id TEXT,
  drive_last_upload_at TIMESTAMPTZ,
  drive_last_status TEXT,
  retain_daily INT NOT NULL DEFAULT 30,
  retain_monthly INT NOT NULL DEFAULT 12,
  retain_manual INT NOT NULL DEFAULT 5,
  schedule_cron TEXT NOT NULL DEFAULT '59 23 * * *',
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.backup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_settings TO authenticated;
GRANT ALL ON public.backup_settings TO service_role;
ALTER TABLE public.backup_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin manages backup settings"
  ON public.backup_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE TRIGGER trg_backup_settings_touch
  BEFORE UPDATE ON public.backup_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
