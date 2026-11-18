-- ===== 1. Closing: store adjustment context, one active adjustment per closing =====
ALTER TABLE public.stock_closings
  ADD COLUMN IF NOT EXISTS farm_id uuid,
  ADD COLUMN IF NOT EXISTS shop_id uuid,
  ADD COLUMN IF NOT EXISTS bird_count integer;

CREATE UNIQUE INDEX IF NOT EXISTS stock_adjustments_one_active_per_closing
  ON public.stock_adjustments (closing_id)
  WHERE closing_id IS NOT NULL AND original_adjustment_id IS NULL AND reversed_at IS NULL;

CREATE OR REPLACE FUNCTION public.finalize_stock_closing(p_id uuid)
 RETURNS stock_closings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _c.status = 'finalized' AND _c.reversed_at IS NULL THEN RETURN _c; END IF;

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

  _variance := ROUND(COALESCE(_c.variance_weight, _c.physical_stock - _c.system_stock), 3);
  IF ABS(_variance) >= 0.001 AND (_c.reason IS NULL OR length(trim(_c.reason)) = 0) THEN
    RAISE EXCEPTION 'A variance reason is required when physical closing does not match expected' USING ERRCODE = '22023';
  END IF;

  -- Post exactly ONE adjustment for this closing (before locking the day,
  -- so the finalized-day guard does not block it). The unique index makes a
  -- second copy impossible.
  IF ABS(_variance) >= 0.001 THEN
    INSERT INTO public.stock_adjustments
      (tenant_id, adjustment_date, meat_type, quantity_kg, reason, reason_id, notes,
       closing_id, created_by, farm_id, shop_id, bird_count)
    VALUES (_c.tenant_id, _c.closing_date, _c.meat_type, _variance, _c.reason, _c.reason_id, _c.notes,
       _c.id, auth.uid(), _c.farm_id, _c.shop_id, _c.bird_count)
    ON CONFLICT (closing_id) WHERE closing_id IS NOT NULL AND original_adjustment_id IS NULL AND reversed_at IS NULL
    DO NOTHING;
  END IF;

  _shortage_kg := GREATEST(0, -_variance);
  _war := public.compute_closing_war(_c.tenant_id, _c.meat_type, _c.closing_date);

  UPDATE public.stock_closings
     SET status = 'finalized',
         finalized_at = now(),
         finalized_by = auth.uid(),
         reversed_at = NULL,
         reversed_by = NULL,
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
END $function$;

-- ===== 2. Reverse (un-finalize) a closing =====
CREATE OR REPLACE FUNCTION public.reverse_stock_closing(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.stock_closings;
  _later int;
  _adj public.stock_adjustments;
  _new_id uuid;
  _n int := 0;
BEGIN
  PERFORM public.assert_can_reverse_module('stock_closing');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _c FROM public.stock_closings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closing not found'; END IF;
  IF _c.status <> 'finalized' OR _c.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only a finalized closing can be reversed' USING ERRCODE = '22023';
  END IF;
  IF _c.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Closing not found' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO _later
    FROM public.stock_closings
   WHERE tenant_id = _c.tenant_id AND meat_type = _c.meat_type
     AND closing_date > _c.closing_date AND status = 'finalized' AND reversed_at IS NULL;
  IF _later > 0 THEN
    RAISE EXCEPTION 'Cannot reverse: a later finalized % closing exists after %. Reverse it first.', _c.meat_type, _c.closing_date USING ERRCODE = 'P0001';
  END IF;

  -- Unlock the day first so the linked adjustment can be reversed.
  UPDATE public.stock_closings
     SET status = 'draft', finalized_at = NULL, finalized_by = NULL, shortage_cost = 0,
         reversed_at = now(), reversed_by = auth.uid(),
         reversal_reason = p_reason, reversal_notes = p_notes
   WHERE id = _c.id;

  -- Reverse each active adjustment exactly once (errors abort the whole reversal).
  FOR _adj IN
    SELECT * FROM public.stock_adjustments
     WHERE closing_id = _c.id AND reversed_at IS NULL AND original_adjustment_id IS NULL
     FOR UPDATE
  LOOP
    INSERT INTO public.stock_adjustments
      (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes, closing_id, created_by,
       original_adjustment_id, reversal_reason, reversal_notes)
    VALUES (_adj.tenant_id, _adj.adjustment_date, _adj.meat_type, -_adj.quantity_kg, _adj.reason,
       'Reversal of closing adjustment — ' || p_reason, _adj.closing_id, auth.uid(),
       _adj.id, p_reason, p_notes)
    RETURNING id INTO _new_id;
    UPDATE public.stock_adjustments
       SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason,
           reversal_notes = p_notes, reversal_adjustment_id = _new_id
     WHERE id = _adj.id;
    _n := _n + 1;
  END LOOP;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES ('closing_reversed', 'stock_closing', _c.id, _c.tenant_id,
    jsonb_build_object('closing_date', _c.closing_date, 'meat_type', _c.meat_type,
      'reason', p_reason, 'notes', p_notes, 'adjustments_reversed', _n), auth.uid());

  RETURN _c.id;
END $function$;

-- ===== 3. Consistent closed-day guard for deliveries =====
DROP TRIGGER IF EXISTS trg_guard_finalized_deliveries ON public.deliveries;
CREATE TRIGGER trg_guard_finalized_deliveries BEFORE DELETE OR UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_edit_after_finalized_closing('loading_date', '');

-- ===== 4. Notifications: valid event names, never an invalid enum cast =====
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'expense_reversed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'customer_payment_reversed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pos_sale_created';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pos_sale_voided';

CREATE OR REPLACE FUNCTION public.notif_business_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _module text  := CASE TG_ARGV[0] WHEN 'purchases' THEN 'purchase' WHEN 'supplies' THEN 'supply' ELSE TG_ARGV[0] END;
  _label  text  := TG_ARGV[1];
  _title  text;
  _msg    text;
  _prio   public.notification_priority := 'normal';
  _type   public.notification_type;
  _tid    uuid;
  _eid    uuid;
  _rev_was_null boolean;
  _rev_is_null  boolean;
  _amount numeric;
  _suffix text;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN _suffix := '_created';
    ELSIF TG_OP = 'UPDATE' THEN
      _rev_was_null := (to_jsonb(OLD) ? 'reversed_at') AND (to_jsonb(OLD)->>'reversed_at') IS NULL;
      _rev_is_null  := (to_jsonb(NEW) ? 'reversed_at') AND (to_jsonb(NEW)->>'reversed_at') IS NULL;
      IF NOT (_rev_was_null AND NOT _rev_is_null) THEN RETURN NEW; END IF;
      _suffix := '_reversed';
    ELSE RETURN NEW; END IF;

    IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
               WHERE t.typname = 'notification_type' AND e.enumlabel = _module || _suffix) THEN
      _type := (_module || _suffix)::public.notification_type;
    ELSE
      _type := 'system'::public.notification_type;
    END IF;

    _tid := (to_jsonb(NEW)->>'tenant_id')::uuid;
    _eid := (to_jsonb(NEW)->>'id')::uuid;
    IF _suffix = '_created' THEN
      _amount := COALESCE(NULLIF(to_jsonb(NEW)->>'total_amount','')::numeric,
                          NULLIF(to_jsonb(NEW)->>'amount','')::numeric, 0);
      _title := _label || ' recorded';
      _msg  := _label || ' entry created' ||
               CASE WHEN _amount > 0 THEN ' — amount ' || to_char(_amount,'FM999,999,990.00') ELSE '' END;
    ELSE
      _prio := 'high';
      _title := _label || ' reversed';
      _msg  := _label || ' entry reversed — ' || COALESCE(to_jsonb(NEW)->>'reversal_reason','no reason provided');
    END IF;
    PERFORM public.notify_admins_of_tenant(
      _tid, auth.uid(), _type, _title, _msg, _prio,
      _module, TG_TABLE_NAME, _eid,
      jsonb_build_object('op', CASE WHEN _suffix = '_created' THEN 'INSERT' ELSE 'REVERSE' END, 'row', to_jsonb(NEW)),
      CASE WHEN _suffix = '_created' THEN 'insert:' ELSE 'reverse:' END || TG_TABLE_NAME || ':' || _eid::text
    );
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.log_system_error(
        COALESCE(_module, TG_TABLE_NAME),
        'notif_business_event failed: ' || SQLERRM,
        'error'::public.system_error_severity,
        NULL,
        jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'sqlstate', SQLSTATE),
        'trigger', NULL, NULL, NULL, _tid
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END $function$;

-- ===== 5. Activity log: fast tenant reads =====
CREATE INDEX IF NOT EXISTS activity_logs_tenant_created_idx ON public.activity_logs (tenant_id, created_at DESC);
DROP POLICY IF EXISTS "owners/managers read tenant logs" ON public.activity_logs;
CREATE POLICY "owners/managers read tenant logs" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.tenant_has_active_subscription(public.current_tenant_id()))
    AND (SELECT public.is_tenant_manager_or_owner(auth.uid(), public.current_tenant_id()))
  );

-- ===== 6. POS sales: void, cost and stock =====
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.pos_sale_items ADD COLUMN IF NOT EXISTS cost_per_kg numeric NOT NULL DEFAULT 0;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS pos_sale_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stock_adjustments_pos_sale_idx ON public.stock_adjustments (pos_sale_id);

CREATE OR REPLACE FUNCTION public.pos_item_set_cost()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _d date;
BEGIN
  SELECT sale_date INTO _d FROM public.pos_sales WHERE id = NEW.sale_id;
  NEW.cost_per_kg := ROUND(public.compute_closing_war(NEW.tenant_id, NEW.meat_type, COALESCE(_d, CURRENT_DATE)), 2);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pos_item_post_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _s public.pos_sales;
BEGIN
  SELECT * INTO _s FROM public.pos_sales WHERE id = NEW.sale_id;
  IF NOT FOUND OR _s.voided_at IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.stock_adjustments
    (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes, created_by, pos_sale_id)
  VALUES (NEW.tenant_id, _s.sale_date, NEW.meat_type, -ROUND(NEW.weight_kg, 3), 'pos_sale',
    'POS invoice #' || _s.invoice_no, auth.uid(), _s.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_item_cost ON public.pos_sale_items;
CREATE TRIGGER trg_pos_item_cost BEFORE INSERT ON public.pos_sale_items
  FOR EACH ROW EXECUTE FUNCTION public.pos_item_set_cost();
DROP TRIGGER IF EXISTS trg_pos_item_stock ON public.pos_sale_items;
CREATE TRIGGER trg_pos_item_stock AFTER INSERT ON public.pos_sale_items
  FOR EACH ROW EXECUTE FUNCTION public.pos_item_post_stock();

-- Backfill: existing POS sales get their cost and stock deduction once.
UPDATE public.pos_sale_items i SET cost_per_kg = ROUND(public.compute_closing_war(i.tenant_id, i.meat_type, s.sale_date), 2)
  FROM public.pos_sales s WHERE s.id = i.sale_id AND i.cost_per_kg = 0;
INSERT INTO public.stock_adjustments (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes, created_by, pos_sale_id)
SELECT i.tenant_id, s.sale_date, i.meat_type, -ROUND(i.weight_kg, 3), 'pos_sale', 'POS invoice #' || s.invoice_no, s.created_by, s.id
  FROM public.pos_sale_items i JOIN public.pos_sales s ON s.id = i.sale_id
 WHERE s.voided_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.stock_adjustments a WHERE a.pos_sale_id = s.id);

CREATE OR REPLACE FUNCTION public.void_pos_sale(p_id uuid, p_reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _s public.pos_sales; _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'A reason is required to void an invoice' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _s FROM public.pos_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (_s.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF _s.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Invoice is already void'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_owner(auth.uid())
          OR public.has_permission(auth.uid(), 'pos', 'delete')
          OR public.has_permission(auth.uid(), 'pos', 'reverse')) THEN
    RAISE EXCEPTION 'You do not have permission to void invoices' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pos_sales SET voided_at = now(), voided_by = auth.uid(), void_reason = p_reason WHERE id = _s.id;
  -- Return the stock: retire the sale's stock deductions (kept for history).
  UPDATE public.stock_adjustments
     SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = 'POS invoice voided: ' || p_reason
   WHERE pos_sale_id = _s.id AND reversed_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES ('pos_sale_voided', 'pos_sales', _s.id::text, _s.tenant_id,
    jsonb_build_object('invoice_no', _s.invoice_no, 'total', _s.total, 'paid', _s.paid,
      'due', _s.due, 'reason', p_reason, 'stock_lines_returned', _n), auth.uid());
  RETURN _s.id;
END $$;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid, text) TO authenticated;

-- ===== 7. Clean decimals: money 2 dp, weights 3 dp =====
CREATE OR REPLACE FUNCTION public.round_numeric_fields()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE _j jsonb := to_jsonb(NEW); _col text; _dp int;
BEGIN
  FOR _col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid = 'numeric'::regtype
  LOOP
    IF _j ? _col AND jsonb_typeof(_j->_col) = 'number' THEN
      _dp := CASE
        WHEN _col ~ '(rate|cost|amount|price|total|paid|due|discount|faraq|subtotal|balance|fare|expense)' THEN 2
        WHEN _col ~ '(kg|weight|quantity|stock|difference|purchases|supplies|adjustments)' THEN 3
        ELSE 2 END;
      _j := jsonb_set(_j, ARRAY[_col], to_jsonb(ROUND((_j->>_col)::numeric, _dp)));
    END IF;
  END LOOP;
  NEW := jsonb_populate_record(NEW, _j);
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchases','supplies','pos_sales','pos_sale_items','expenses','shop_ledger_entries',
    'shop_recoveries','stock_adjustments','stock_closings','farm_payments','supplier_ledger_entries',
    'deliveries','customer_payments','payments']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aa_round_numeric ON public.%I', t);
    EXECUTE format('CREATE TRIGGER aa_round_numeric BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.round_numeric_fields()', t);
  END LOOP;
END $$;