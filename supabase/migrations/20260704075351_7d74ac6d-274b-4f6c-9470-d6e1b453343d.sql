
ALTER TABLE public.backup_history
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backup_name text,
  ADD COLUMN IF NOT EXISTS tenant_name text;

CREATE INDEX IF NOT EXISTS backup_history_tenant_id_idx ON public.backup_history(tenant_id);
