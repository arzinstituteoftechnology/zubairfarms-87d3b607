
-- Stock adjustment reason enum
DO $$ BEGIN
  CREATE TYPE public.stock_adjustment_reason AS ENUM ('weight_loss','mortality','wastage','damage','theft','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Daily closing stock entries (one per meat_type per date per tenant)
CREATE TABLE IF NOT EXISTS public.stock_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  closing_date date NOT NULL,
  meat_type text NOT NULL,
  opening_stock numeric NOT NULL DEFAULT 0,
  purchases_kg numeric NOT NULL DEFAULT 0,
  supplies_kg numeric NOT NULL DEFAULT 0,
  adjustments_kg numeric NOT NULL DEFAULT 0,
  system_stock numeric NOT NULL DEFAULT 0,
  physical_stock numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  reason public.stock_adjustment_reason,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, closing_date, meat_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_closings TO authenticated;
GRANT ALL ON public.stock_closings TO service_role;

ALTER TABLE public.stock_closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant all stock_closings" ON public.stock_closings
  FOR ALL
  USING (is_super_admin() OR ((tenant_id = current_tenant_id()) AND tenant_has_active_subscription(tenant_id)))
  WITH CHECK (is_super_admin() OR ((tenant_id = current_tenant_id()) AND tenant_has_active_subscription(tenant_id)));

CREATE TRIGGER stock_closings_tenant BEFORE INSERT ON public.stock_closings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

CREATE TRIGGER stock_closings_touch BEFORE UPDATE ON public.stock_closings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Stock adjustment audit trail (immutable log)
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  adjustment_date date NOT NULL,
  meat_type text NOT NULL,
  quantity_kg numeric NOT NULL,
  reason public.stock_adjustment_reason NOT NULL,
  notes text,
  closing_id uuid REFERENCES public.stock_closings(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read stock_adjustments" ON public.stock_adjustments
  FOR SELECT
  USING (is_super_admin() OR ((tenant_id = current_tenant_id()) AND tenant_has_active_subscription(tenant_id)));

CREATE POLICY "tenant insert stock_adjustments" ON public.stock_adjustments
  FOR INSERT
  WITH CHECK (is_super_admin() OR ((tenant_id = current_tenant_id()) AND tenant_has_active_subscription(tenant_id)));

CREATE TRIGGER stock_adjustments_tenant BEFORE INSERT ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

CREATE INDEX IF NOT EXISTS stock_adjustments_tenant_date_idx ON public.stock_adjustments(tenant_id, adjustment_date);
CREATE INDEX IF NOT EXISTS stock_closings_tenant_date_idx ON public.stock_closings(tenant_id, closing_date);
