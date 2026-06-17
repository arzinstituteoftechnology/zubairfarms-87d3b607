
-- Audit columns
ALTER TABLE public.shop_ledger_entries
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.shop_recoveries
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Audit trigger function (generic): stamps edited_by/edited_at on UPDATE
CREATE OR REPLACE FUNCTION public.stamp_edited_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.edited_at := now();
  NEW.edited_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_edit_shop_ledger ON public.shop_ledger_entries;
CREATE TRIGGER trg_audit_edit_shop_ledger
BEFORE UPDATE ON public.shop_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.stamp_edited_audit();

DROP TRIGGER IF EXISTS trg_audit_edit_shop_recoveries ON public.shop_recoveries;
CREATE TRIGGER trg_audit_edit_shop_recoveries
BEFORE UPDATE ON public.shop_recoveries
FOR EACH ROW EXECUTE FUNCTION public.stamp_edited_audit();
