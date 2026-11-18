CREATE OR REPLACE FUNCTION public.guard_edit_after_finalized_closing()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  _date_col text := TG_ARGV[0];
  _meat_col text := NULLIF(TG_ARGV[1], '');
  _tid uuid; _old_rev text; _new_rev text;
  _d date; _m text; _hit date; _rec jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.is_super_admin() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' THEN
    _old_rev := to_jsonb(OLD)->>'reversed_at';
    _new_rev := to_jsonb(NEW)->>'reversed_at';
    IF _old_rev IS NULL AND _new_rev IS NOT NULL THEN RETURN NEW; END IF;
    IF _old_rev IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  FOR _rec IN
    SELECT x FROM (VALUES
      (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END),
      (CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) END)) v(x)
    WHERE x IS NOT NULL
  LOOP
    _d := NULLIF(_rec->>_date_col, '')::date;
    _tid := NULLIF(_rec->>'tenant_id', '')::uuid;
    CONTINUE WHEN _d IS NULL OR _tid IS NULL;
    _m := CASE WHEN _meat_col IS NULL THEN NULL ELSE _rec->>_meat_col END;
    SELECT min(closing_date) INTO _hit FROM public.stock_closings
     WHERE tenant_id = _tid AND status = 'finalized' AND reversed_at IS NULL
       AND closing_date >= _d AND (_m IS NULL OR meat_type = _m);
    IF _hit IS NOT NULL THEN
      RAISE EXCEPTION 'CLOSING_LOCKED: The % closing for % is finalized, so stock records dated % cannot be changed. Reverse that closing in Closing History first.',
        COALESCE(_m, 'stock'), _hit, _d USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $fn$;

COMMENT ON FUNCTION public.guard_edit_after_finalized_closing() IS
  'One closing-lock rule: a finalized, unreversed closing freezes only stock-changing records (purchases, supplies, stock_adjustments, pos_sales) dated on/before it. Checks old and new dates on update.';

DROP TRIGGER IF EXISTS trg_guard_finalized_expenses ON public.expenses;
DROP TRIGGER IF EXISTS trg_guard_finalized_deliveries ON public.deliveries;
DROP TRIGGER IF EXISTS trg_guard_finalized_recoveries ON public.shop_recoveries;
DROP TRIGGER IF EXISTS trg_guard_finalized_pos_sales ON public.pos_sales;
CREATE TRIGGER trg_guard_finalized_pos_sales
  BEFORE INSERT OR UPDATE OR DELETE ON public.pos_sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('sale_date', '');

-- Reversal rows are never dated before the row they reverse.
CREATE OR REPLACE FUNCTION public.reversal_date_not_before_original()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _orig date;
BEGIN
  IF TG_TABLE_NAME = 'stock_adjustments' THEN
    IF NEW.original_adjustment_id IS NOT NULL THEN
      SELECT adjustment_date INTO _orig FROM public.stock_adjustments WHERE id = NEW.original_adjustment_id;
      IF _orig IS NOT NULL AND NEW.adjustment_date < _orig THEN NEW.adjustment_date := _orig; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'shop_ledger_entries' THEN
    IF NEW.original_entry_id IS NOT NULL THEN
      SELECT entry_date INTO _orig FROM public.shop_ledger_entries WHERE id = NEW.original_entry_id;
      IF _orig IS NOT NULL AND NEW.entry_date < _orig THEN NEW.entry_date := _orig; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_ledger_entries' THEN
    IF NEW.original_entry_id IS NOT NULL THEN
      SELECT entry_date INTO _orig FROM public.supplier_ledger_entries WHERE id = NEW.original_entry_id;
      IF _orig IS NOT NULL AND NEW.entry_date < _orig THEN NEW.entry_date := _orig; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS aa_reversal_date_floor ON public.stock_adjustments;
CREATE TRIGGER aa_reversal_date_floor BEFORE INSERT ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.reversal_date_not_before_original();
DROP TRIGGER IF EXISTS aa_reversal_date_floor ON public.shop_ledger_entries;
CREATE TRIGGER aa_reversal_date_floor BEFORE INSERT ON public.shop_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.reversal_date_not_before_original();
DROP TRIGGER IF EXISTS aa_reversal_date_floor ON public.supplier_ledger_entries;
CREATE TRIGGER aa_reversal_date_floor BEFORE INSERT ON public.supplier_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.reversal_date_not_before_original();