
ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text,
  ADD COLUMN IF NOT EXISTS original_adjustment_id uuid REFERENCES public.stock_adjustments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_adjustment_id uuid REFERENCES public.stock_adjustments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.reverse_stock_adjustment(p_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _orig public.stock_adjustments;
  _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _orig FROM public.stock_adjustments WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Adjustment already reversed'; END IF;
  IF _orig.original_adjustment_id IS NOT NULL THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;

  INSERT INTO public.stock_adjustments
    (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes, closing_id, created_by, original_adjustment_id, reversal_reason, reversal_notes)
  VALUES
    (_orig.tenant_id, CURRENT_DATE, _orig.meat_type, -_orig.quantity_kg, _orig.reason,
     'Reversal of adjustment (' || _orig.adjustment_date || ') — ' || p_reason,
     _orig.closing_id, auth.uid(), _orig.id, p_reason, p_notes)
  RETURNING id INTO _new_id;

  UPDATE public.stock_adjustments
    SET reversed_at = now(), reversed_by = auth.uid(),
        reversal_reason = p_reason, reversal_notes = p_notes,
        reversal_adjustment_id = _new_id
    WHERE id = _orig.id;

  RETURN _new_id;
END;
$$;
