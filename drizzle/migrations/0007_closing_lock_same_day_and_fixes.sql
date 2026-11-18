CREATE OR REPLACE FUNCTION public.guard_edit_after_finalized_closing()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _date_col text := TG_ARGV[0];
  _meat_col text := NULLIF(TG_ARGV[1], '');
  _tid uuid; _old_rev text; _new_rev text;
  _d date; _m text; _hit date; _rec jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.is_super_admin() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(to_jsonb(NEW)->>'closing_id', '') IS NOT NULL
       OR NULLIF(to_jsonb(NEW)->>'original_adjustment_id', '') IS NOT NULL THEN
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
    -- Lock covers ONLY the finalized closing's own date.
    SELECT closing_date INTO _hit FROM public.stock_closings
     WHERE tenant_id = _tid AND status = 'finalized' AND reversed_at IS NULL
       AND closing_date = _d AND (_m IS NULL OR meat_type = _m)
     LIMIT 1;
    IF _hit IS NOT NULL THEN
      RAISE EXCEPTION 'CLOSING_LOCKED: The % closing for % is finalized, so stock records dated % cannot be changed. Reverse that closing in Closing History first.',
        COALESCE(_m, 'stock'), _hit, _d USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.reverse_stock_adjustment(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _orig public.stock_adjustments; _new_id uuid; _cstat text; _crev timestamptz;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('stock_closing');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _orig FROM public.stock_adjustments WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Adjustment already reversed'; END IF;
  IF _orig.original_adjustment_id IS NOT NULL THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;
  IF _orig.pos_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'This stock entry belongs to a POS invoice. Void the invoice in POS instead.' USING ERRCODE = '22023';
  END IF;
  IF _orig.closing_id IS NOT NULL THEN
    SELECT status::text, reversed_at INTO _cstat, _crev FROM public.stock_closings WHERE id = _orig.closing_id;
    IF _cstat = 'finalized' AND _crev IS NULL THEN
      RAISE EXCEPTION 'CLOSING_LOCKED: This entry belongs to the finalized % closing for %. Reverse that closing in Closing History first.',
        _orig.meat_type, _orig.adjustment_date USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO public.stock_adjustments
    (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes, closing_id, created_by, original_adjustment_id, reversal_reason, reversal_notes)
  VALUES (_orig.tenant_id, _orig.adjustment_date, _orig.meat_type, -_orig.quantity_kg, _orig.reason,
     'Reversal of adjustment (' || _orig.adjustment_date || ') — ' || p_reason,
     _orig.closing_id, auth.uid(), _orig.id, p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.stock_adjustments SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_adjustment_id = _new_id WHERE id = _orig.id;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.count_activity_logs(_module text DEFAULT NULL, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _actor uuid DEFAULT NULL, _q text DEFAULT NULL)
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _tid uuid := public.current_tenant_id(); _n bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _tid IS NULL OR NOT public.is_tenant_manager_or_owner(auth.uid(), _tid) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO _n FROM public.activity_logs l
   WHERE l.tenant_id = _tid
     AND (_module IS NULL OR (_module = 'authentication' AND l.action LIKE 'auth\_%')
          OR (_module <> 'authentication' AND (l.entity = _module OR l.action LIKE _module || '\_%')))
     AND (_from IS NULL OR l.created_at >= _from)
     AND (_to IS NULL OR l.created_at <= _to)
     AND (_actor IS NULL OR l.actor_user_id = _actor)
     AND (_q IS NULL OR l.action ILIKE '%' || _q || '%' OR l.entity ILIKE '%' || _q || '%' OR l.entity_id::text ILIKE '%' || _q || '%');
  RETURN _n;
END $function$;
REVOKE ALL ON FUNCTION public.count_activity_logs(text, timestamptz, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_activity_logs(text, timestamptz, timestamptz, uuid, text) TO authenticated;

ALTER TABLE public.expenses ADD CONSTRAINT expenses_amount_nonnegative CHECK (amount >= 0) NOT VALID;