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
  IF TG_OP = 'INSERT' THEN
    -- System rows: a closing's own adjustment, or a reversal of an existing row.
    IF NULLIF(to_jsonb(NEW)->>'closing_id', '') IS NOT NULL
       OR NULLIF(to_jsonb(NEW)->>'original_adjustment_id', '') IS NOT NULL
       OR NULLIF(to_jsonb(NEW)->>'pos_sale_id', '') IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;
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

DROP TRIGGER IF EXISTS trg_guard_finalized_purchases ON public.purchases;
CREATE TRIGGER trg_guard_finalized_purchases BEFORE INSERT OR UPDATE OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('purchase_date', 'meat_type');
DROP TRIGGER IF EXISTS trg_guard_finalized_supplies ON public.supplies;
CREATE TRIGGER trg_guard_finalized_supplies BEFORE INSERT OR UPDATE OR DELETE ON public.supplies
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('supply_date', 'meat_type');
DROP TRIGGER IF EXISTS trg_guard_finalized_adjustments ON public.stock_adjustments;
CREATE TRIGGER trg_guard_finalized_adjustments BEFORE INSERT OR UPDATE OR DELETE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('adjustment_date', 'meat_type');