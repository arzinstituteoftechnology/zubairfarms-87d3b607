
-- 1) Opening balance on shops
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;

-- 2) Enum for entry type
DO $$ BEGIN
  CREATE TYPE public.shop_ledger_type AS ENUM (
    'opening_balance','manual_supply','manual_payment','adjustment_increase','adjustment_decrease'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Ledger entries table
CREATE TABLE IF NOT EXISTS public.shop_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT (now()::date),
  entry_type public.shop_ledger_type NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_ledger_amount_nonneg CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS shop_ledger_shop_idx ON public.shop_ledger_entries(shop_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS shop_ledger_tenant_idx ON public.shop_ledger_entries(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_ledger_entries TO authenticated;
GRANT ALL ON public.shop_ledger_entries TO service_role;

ALTER TABLE public.shop_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users manage shop ledger"
  ON public.shop_ledger_entries
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

CREATE TRIGGER shop_ledger_enforce_tenant
  BEFORE INSERT OR UPDATE ON public.shop_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

CREATE TRIGGER shop_ledger_touch_updated_at
  BEFORE UPDATE ON public.shop_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
