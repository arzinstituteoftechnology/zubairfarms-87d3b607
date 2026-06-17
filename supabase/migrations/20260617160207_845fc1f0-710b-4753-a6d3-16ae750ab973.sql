
-- Helper: verify caller is admin or super_admin
CREATE OR REPLACE FUNCTION public._assert_can_reverse()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin() OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Only Admin or Super Admin can reverse transactions' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_can_reverse() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_can_reverse() TO authenticated, service_role;

-- ============================================================
-- Shop ledger entry reversal (manual_*, adjustment_*, opening_balance, recovery)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_shop_ledger_entry(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_shop_ledger_entry(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_shop_ledger_entry(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- Supplier ledger entry reversal
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_supplier_ledger_entry(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _orig public.supplier_ledger_entries;
  _new_id uuid;
  _new_type public.supplier_ledger_type;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _orig FROM public.supplier_ledger_entries WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger entry not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF _orig.entry_type::text LIKE 'reversed_%' THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;

  _new_type := ('reversed_' || _orig.entry_type::text)::public.supplier_ledger_type;

  INSERT INTO public.supplier_ledger_entries
    (tenant_id, supplier_id, entry_type, entry_date, description, amount, created_by, original_entry_id, reversal_reason, reversal_notes)
  VALUES
    (_orig.tenant_id, _orig.supplier_id, _new_type, CURRENT_DATE,
     'Reversal of ' || _orig.entry_type::text || ' (' || _orig.entry_date || ') — ' || p_reason,
     _orig.amount, auth.uid(), _orig.id, p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.supplier_ledger_entries
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_entry_id = _new_id
    WHERE id = _orig.id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_supplier_ledger_entry(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_ledger_entry(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- Reverse a Supply: insert reversed_supply credit in shop ledger
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_supply(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.supplies;
  _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _s FROM public.supplies WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supply not found'; END IF;
  IF _s.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Supply already reversed'; END IF;

  INSERT INTO public.shop_ledger_entries
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES
    (_s.tenant_id, _s.shop_id, 'reversed_supply', CURRENT_DATE,
     'Reversal of supply (' || _s.supply_date || ', ' || COALESCE(_s.meat_type, '') || ') — ' || p_reason,
     COALESCE(_s.total_amount, 0), auth.uid(), p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.supplies
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_ledger_entry_id = _new_id
    WHERE id = _s.id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_supply(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_supply(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- Reverse a Purchase: insert reversed_purchase credit in supplier ledger
-- Reverses NET (total_amount - paid_amount) so balance is restored.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_purchase(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p public.purchases;
  _new_id uuid;
  _net numeric;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _p FROM public.purchases WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
  IF _p.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Purchase already reversed'; END IF;

  _net := COALESCE(_p.total_amount, 0) - COALESCE(_p.paid_amount, 0);

  INSERT INTO public.supplier_ledger_entries
    (tenant_id, supplier_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES
    (_p.tenant_id, _p.farm_id, 'reversed_purchase', CURRENT_DATE,
     'Reversal of purchase (' || _p.purchase_date || ', ' || COALESCE(_p.meat_type, '') || ', net ' || _net || ') — ' || p_reason,
     _net, auth.uid(), p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.purchases
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_ledger_entry_id = _new_id
    WHERE id = _p.id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_purchase(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_purchase(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- Reverse a Farm Payment: insert reversed_payment debit in supplier ledger
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_farm_payment(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fp public.farm_payments;
  _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _fp FROM public.farm_payments WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF _fp.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Payment already reversed'; END IF;

  INSERT INTO public.supplier_ledger_entries
    (tenant_id, supplier_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES
    (_fp.tenant_id, _fp.farm_id, 'reversed_payment', CURRENT_DATE,
     'Reversal of payment (' || _fp.payment_date || ', ' || COALESCE(_fp.method, '') || ') — ' || p_reason,
     COALESCE(_fp.amount, 0), auth.uid(), p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.farm_payments
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_ledger_entry_id = _new_id
    WHERE id = _fp.id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_farm_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_farm_payment(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- Reverse a Shop Recovery: insert reversed_recovery debit in shop ledger,
-- mark recovery as reversed (original recovery row is preserved)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_shop_recovery(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES
    (_r.tenant_id, _r.shop_id, 'reversed_recovery', CURRENT_DATE,
     'Reversal of recovery (' || _r.recovery_date || ', ' || _r.payment_method || ')'
       || COALESCE(' — Collector: ' || NULLIF(_r.collected_by, ''), '')
       || ' — ' || p_reason,
     COALESCE(_r.amount, 0), auth.uid(), p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.shop_recoveries
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_ledger_entry_id = _new_id
    WHERE id = _r.id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_shop_recovery(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_shop_recovery(uuid, text, text) TO authenticated, service_role;
