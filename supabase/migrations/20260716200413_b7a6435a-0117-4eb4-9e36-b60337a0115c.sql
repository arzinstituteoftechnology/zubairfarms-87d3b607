
-- ============================================================
-- Phase 2 — Daily Closing Variance: RPCs + realtime
-- ============================================================

-- Add stock_closings + stock_adjustments to realtime publication (idempotent)
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_closings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_adjustments; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ------------------------------------------------------------
-- Weighted-avg purchase rate (rolling 30 days ending on date)
-- Tenant-scoped and per meat_type. Falls back to 0 if no purchases.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_closing_war(p_tenant uuid, p_meat text, p_date date)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(SUM(total_amount), 0) / NULLIF(SUM(weight_kg), 0),
    0
  )
  FROM public.purchases
  WHERE tenant_id = p_tenant
    AND meat_type = p_meat
    AND reversed_at IS NULL
    AND purchase_date <= p_date
    AND purchase_date >= (p_date - INTERVAL '29 days')::date
$$;

REVOKE ALL ON FUNCTION public.compute_closing_war(uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_closing_war(uuid, text, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Finalize a Draft closing (idempotent-ish; refuses if already finalized)
-- Server-side re-validates and recomputes shortage_cost from rolling 30-day WAR
-- ------------------------------------------------------------
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Closing not found';
  END IF;
  IF _c.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Closing already reversed';
  END IF;
  IF _c.status = 'finalized' THEN
    -- Idempotent: return existing record without re-writing shortage_cost
    RETURN _c;
  END IF;

  -- Permission check (reuse approve as the finalize gate; owners bypass in has_permission)
  IF NOT public.has_permission(auth.uid(), 'stock_closing', 'approve')
     AND NOT public.is_super_admin()
     AND NOT public.is_tenant_owner(auth.uid()) THEN
    INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
    VALUES ('unauthorized_closing_attempt', 'stock_closing', _c.id, _c.tenant_id,
      jsonb_build_object('required_action', 'approve'), auth.uid());
    RAISE EXCEPTION 'You do not have permission to finalize closings' USING ERRCODE = '42501';
  END IF;

  -- Server-side reconciliation validation
  IF _c.physical_stock IS NULL THEN
    INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
    VALUES ('closing_reconciliation_failed', 'stock_closing', _c.id, _c.tenant_id,
      jsonb_build_object('reason', 'physical_stock_missing'), auth.uid());
    RAISE EXCEPTION 'Physical stock is required to finalize' USING ERRCODE = '22023';
  END IF;

  _variance := COALESCE(_c.variance_weight, _c.physical_stock - _c.system_stock);
  _shortage_kg := GREATEST(0, -_variance);

  -- Recompute WAR + shortage cost from server-side data (never trust client)
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
      'closing_date', _c.closing_date,
      'meat_type', _c.meat_type,
      'expected', _c.expected_closing_stock,
      'physical', _c.physical_stock,
      'variance_weight', _variance,
      'variance_type', _c.variance_type,
      'war', _war,
      'shortage_cost', _c.shortage_cost
    ), auth.uid());

  RETURN _c;
END $$;

REVOKE ALL ON FUNCTION public.finalize_stock_closing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_stock_closing(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Harden reverse_stock_closing:
--  * refuse if a LATER finalized-unreversed closing exists for
--    the same tenant/meat_type (would corrupt its opening stock)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_stock_closing(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.stock_closings;
  _later int;
  _adj_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('stock_closing');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _c FROM public.stock_closings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closing not found'; END IF;
  IF _c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Closing already reversed'; END IF;

  -- Conflict guard: block if a later finalized/unreversed closing exists
  SELECT count(*) INTO _later
    FROM public.stock_closings
   WHERE tenant_id = _c.tenant_id
     AND meat_type = _c.meat_type
     AND closing_date > _c.closing_date
     AND status = 'finalized'
     AND reversed_at IS NULL;
  IF _later > 0 THEN
    RAISE EXCEPTION 'Cannot reverse: a later finalized closing exists for % on/after %. Reverse it first.', _c.meat_type, _c.closing_date USING ERRCODE = 'P0001';
  END IF;

  -- Reverse the linked adjustment (if any and not already reversed)
  FOR _adj_id IN
    SELECT id FROM public.stock_adjustments
     WHERE closing_id = _c.id AND reversed_at IS NULL AND original_adjustment_id IS NULL
  LOOP
    BEGIN
      PERFORM public.reverse_stock_adjustment(_adj_id, 'Closing reversed: ' || p_reason, p_notes);
    EXCEPTION WHEN OTHERS THEN
      -- Swallow to avoid blocking closing reversal on adjustment reversal issues; audit will show
      INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
      VALUES ('closing_adjustment_reverse_failed', 'stock_closing', _c.id, _c.tenant_id,
        jsonb_build_object('adjustment_id', _adj_id, 'error', SQLERRM), auth.uid());
    END;
  END LOOP;

  UPDATE public.stock_closings
     SET reversed_at = now(),
         reversed_by = auth.uid(),
         reversal_reason = p_reason,
         reversal_notes = p_notes
   WHERE id = _c.id;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES ('closing_reversed', 'stock_closing', _c.id, _c.tenant_id,
    jsonb_build_object('closing_date', _c.closing_date, 'meat_type', _c.meat_type, 'reason', p_reason), auth.uid());

  RETURN _c.id;
END $$;

REVOKE ALL ON FUNCTION public.reverse_stock_closing(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_stock_closing(uuid, text, text) TO authenticated, service_role;
