
-- shop_recoveries table for daily field-staff money collection
CREATE TABLE IF NOT EXISTS public.shop_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  recovery_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank','jazzcash','easypaisa')),
  notes text,
  collected_by uuid,
  ledger_entry_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_recoveries TO authenticated;
GRANT ALL ON public.shop_recoveries TO service_role;

ALTER TABLE public.shop_recoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users manage shop recoveries"
  ON public.shop_recoveries FOR ALL
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_active_subscription(tenant_id))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_has_active_subscription(tenant_id));

-- Enforce tenant safety
CREATE TRIGGER shop_recoveries_tenant_enforce
BEFORE INSERT OR UPDATE ON public.shop_recoveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

CREATE TRIGGER shop_recoveries_touch
BEFORE UPDATE ON public.shop_recoveries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_shop_recoveries_shop ON public.shop_recoveries(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_recoveries_tenant_date ON public.shop_recoveries(tenant_id, recovery_date);

-- Sync trigger: maintain a matching shop_ledger_entries row with entry_type='recovery'
CREATE OR REPLACE FUNCTION public.sync_recovery_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _desc text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.ledger_entry_id IS NOT NULL THEN
      DELETE FROM public.shop_ledger_entries WHERE id = OLD.ledger_entry_id;
    END IF;
    RETURN OLD;
  END IF;

  _desc := COALESCE('Recovery (' || NEW.payment_method || ')' ||
    CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN ' — ' || NEW.notes ELSE '' END, 'Recovery');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
    VALUES (NEW.tenant_id, NEW.shop_id, 'recovery', NEW.recovery_date, _desc, NEW.amount, NEW.created_by)
    RETURNING id INTO NEW.ledger_entry_id;
    UPDATE public.shop_recoveries SET ledger_entry_id = NEW.ledger_entry_id WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.ledger_entry_id IS NULL THEN
      INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
      VALUES (NEW.tenant_id, NEW.shop_id, 'recovery', NEW.recovery_date, _desc, NEW.amount, NEW.created_by)
      RETURNING id INTO NEW.ledger_entry_id;
    ELSE
      UPDATE public.shop_ledger_entries
        SET shop_id = NEW.shop_id,
            entry_date = NEW.recovery_date,
            description = _desc,
            amount = NEW.amount
        WHERE id = NEW.ledger_entry_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER shop_recoveries_sync_ins
AFTER INSERT ON public.shop_recoveries
FOR EACH ROW EXECUTE FUNCTION public.sync_recovery_to_ledger();

CREATE TRIGGER shop_recoveries_sync_upd
AFTER UPDATE ON public.shop_recoveries
FOR EACH ROW EXECUTE FUNCTION public.sync_recovery_to_ledger();

CREATE TRIGGER shop_recoveries_sync_del
BEFORE DELETE ON public.shop_recoveries
FOR EACH ROW EXECUTE FUNCTION public.sync_recovery_to_ledger();
