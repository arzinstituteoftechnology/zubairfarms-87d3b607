
-- ============================================================
-- Phase 3 — Closing lock + finalize validation
-- ============================================================

-- 1) Finalize-lock guard trigger
CREATE OR REPLACE FUNCTION public.guard_edit_after_finalized_closing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _date_col text := TG_ARGV[0];
  _meat_col text := TG_ARGV[1];
  _row_date date;
  _meat text;
  _tid uuid;
  _exists boolean;
  _old_rev text;
  _new_rev text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.is_super_admin() THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' THEN
    _old_rev := to_jsonb(OLD)->>'reversed_at';
    _new_rev := to_jsonb(NEW)->>'reversed_at';
    -- Allow the reversal write itself
    IF _old_rev IS NULL AND _new_rev IS NOT NULL THEN
      RETURN NEW;
    END IF;
    -- Skip when already reversed
    IF _old_rev IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  _row_date := NULLIF(to_jsonb(COALESCE(NEW,OLD))->>_date_col, '')::date;
  _tid := NULLIF(to_jsonb(COALESCE(NEW,OLD))->>'tenant_id', '')::uuid;
  IF _row_date IS NULL OR _tid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF _meat_col IS NOT NULL AND _meat_col <> '' THEN
    _meat := to_jsonb(COALESCE(NEW,OLD))->>_meat_col;
    SELECT EXISTS(
      SELECT 1 FROM public.stock_closings
      WHERE tenant_id = _tid
        AND meat_type = _meat
        AND status = 'finalized'
        AND reversed_at IS NULL
        AND closing_date >= _row_date
    ) INTO _exists;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.stock_closings
      WHERE tenant_id = _tid
        AND status = 'finalized'
        AND reversed_at IS NULL
        AND closing_date >= _row_date
    ) INTO _exists;
  END IF;

  IF _exists THEN
    RAISE EXCEPTION 'Cannot % this record — a finalized closing exists on or after %. Reverse the closing first.',
      lower(TG_OP), _row_date
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_finalized_purchases ON public.purchases;
CREATE TRIGGER trg_guard_finalized_purchases
  BEFORE UPDATE OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('purchase_date','meat_type');

DROP TRIGGER IF EXISTS trg_guard_finalized_supplies ON public.supplies;
CREATE TRIGGER trg_guard_finalized_supplies
  BEFORE UPDATE OR DELETE ON public.supplies
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('supply_date','meat_type');

DROP TRIGGER IF EXISTS trg_guard_finalized_adjustments ON public.stock_adjustments;
CREATE TRIGGER trg_guard_finalized_adjustments
  BEFORE UPDATE OR DELETE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('adjustment_date','meat_type');

DROP TRIGGER IF EXISTS trg_guard_finalized_recoveries ON public.shop_recoveries;
CREATE TRIGGER trg_guard_finalized_recoveries
  BEFORE UPDATE OR DELETE ON public.shop_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('recovery_date','');

DROP TRIGGER IF EXISTS trg_guard_finalized_expenses ON public.expenses;
CREATE TRIGGER trg_guard_finalized_expenses
  BEFORE UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('expense_date','');

-- 2) Harden finalize_stock_closing
CREATE OR REPLACE FUNCTION public.finalize_stock_closing(p_id uuid)
RETURNS public.stock_closings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.stock_closings;
  _war numeric;
  _shortage_kg numeric;
  _variance numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _c FROM public.stock_closings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closing not found'; END IF;
  IF _c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Closing already reversed'; END IF;
  IF _c.status = 'finalized' THEN RETURN _c; END IF;

  IF NOT public.has_permission(auth.uid(), 'stock_closing', 'approve')
     AND NOT public.is_super_admin()
     AND NOT public.is_tenant_owner(auth.uid()) THEN
    INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
    VALUES ('unauthorized_closing_attempt', 'stock_closing', _c.id, _c.tenant_id,
      jsonb_build_object('required_action', 'approve'), auth.uid());
    RAISE EXCEPTION 'You do not have permission to finalize closings' USING ERRCODE = '42501';
  END IF;

  IF _c.physical_stock IS NULL THEN
    RAISE EXCEPTION 'Physical stock is required to finalize' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_c.expected_closing_stock, _c.system_stock, 0) < 0 THEN
    RAISE EXCEPTION 'Expected closing stock is negative — investigate purchases, supplies or adjustments before finalizing' USING ERRCODE = '22023';
  END IF;
  IF _c.physical_stock < 0 THEN
    RAISE EXCEPTION 'Physical closing stock cannot be negative' USING ERRCODE = '22023';
  END IF;

  _variance := COALESCE(_c.variance_weight, _c.physical_stock - _c.system_stock);
  IF ABS(_variance) >= 0.001 AND (_c.reason IS NULL OR length(trim(_c.reason)) = 0) THEN
    RAISE EXCEPTION 'A variance reason is required when physical closing does not match expected' USING ERRCODE = '22023';
  END IF;

  _shortage_kg := GREATEST(0, -_variance);
  _war := public.compute_closing_war(_c.tenant_id, _c.meat_type, _c.closing_date);

  UPDATE public.stock_closings
     SET status = 'finalized',
         finalized_at = now(),
         finalized_by = auth.uid(),
         shortage_cost = ROUND(_shortage_kg * _war, 2),
         variance_weight = _variance,
         variance_type = CASE
            WHEN ABS(_variance) < 0.001 THEN 'balanced'
            WHEN _variance < 0 THEN 'shortage'
            ELSE 'surplus'
         END::public.stock_variance_type
   WHERE id = _c.id
   RETURNING * INTO _c;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES ('closing_finalized', 'stock_closing', _c.id, _c.tenant_id,
    jsonb_build_object(
      'closing_date', _c.closing_date, 'meat_type', _c.meat_type,
      'expected', _c.expected_closing_stock, 'physical', _c.physical_stock,
      'variance_weight', _variance, 'variance_type', _c.variance_type,
      'war', _war, 'shortage_cost', _c.shortage_cost
    ), auth.uid());

  RETURN _c;
END $$;
