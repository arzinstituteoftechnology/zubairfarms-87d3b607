CREATE OR REPLACE FUNCTION public.reverse_shop_recovery(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _r public.shop_recoveries;
  _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _r FROM public.shop_recoveries WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery not found'; END IF;
  IF _r.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Recovery already reversed'; END IF;

  INSERT INTO public.shop_ledger_entries
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, original_entry_id, reversal_reason, reversal_notes)
  VALUES
    (_r.tenant_id, _r.shop_id, 'reversed_recovery', CURRENT_DATE,
     'Reversal of recovery (' || _r.recovery_date || ', ' || _r.payment_method || ')'
       || COALESCE(' — Collector: ' || NULLIF(_r.collected_by, ''), '')
       || ' — ' || p_reason,
     COALESCE(_r.amount, 0), auth.uid(), _r.ledger_entry_id, p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.shop_recoveries
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_ledger_entry_id = _new_id
    WHERE id = _r.id;

  UPDATE public.shop_ledger_entries
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_entry_id = _new_id
    WHERE id = _r.ledger_entry_id
      AND reversed_at IS NULL;

  RETURN _new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_shop_ledger_entry(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _orig public.shop_ledger_entries;
  _new_id uuid;
  _new_type public.shop_ledger_type;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _orig FROM public.shop_ledger_entries WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger entry not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF _orig.entry_type::text LIKE 'reversed_%' THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;

  _new_type := ('reversed_' || _orig.entry_type::text)::public.shop_ledger_type;

  INSERT INTO public.shop_ledger_entries
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, original_entry_id, reversal_reason, reversal_notes)
  VALUES
    (_orig.tenant_id, _orig.shop_id, _new_type, CURRENT_DATE,
     'Reversal of ' || _orig.entry_type::text || ' (' || _orig.entry_date || ') — ' || p_reason,
     _orig.amount, auth.uid(), _orig.id, p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.shop_ledger_entries
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_entry_id = _new_id
    WHERE id = _orig.id;

  IF _orig.entry_type::text = 'recovery' THEN
    UPDATE public.shop_recoveries
      SET reversed_at = COALESCE(reversed_at, now()), reversed_by = COALESCE(reversed_by, auth.uid()),
          reversal_reason = COALESCE(reversal_reason, p_reason), reversal_notes = COALESCE(reversal_notes, p_notes),
          reversal_ledger_entry_id = COALESCE(reversal_ledger_entry_id, _new_id)
      WHERE ledger_entry_id = _orig.id;
  END IF;

  RETURN _new_id;
END;
$function$;