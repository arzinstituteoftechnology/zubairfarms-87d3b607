
-- 1) Enum for variance classification
DO $$ BEGIN
  CREATE TYPE public.stock_variance_type AS ENUM ('balanced', 'shortage', 'surplus');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stock_closing_status AS ENUM ('draft', 'finalized');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Extend stock_closings
ALTER TABLE public.stock_closings
  ADD COLUMN IF NOT EXISTS mortality_weight numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_adjustments_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_adjustments_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_closing_stock numeric,
  ADD COLUMN IF NOT EXISTS variance_weight numeric,
  ADD COLUMN IF NOT EXISTS variance_type public.stock_variance_type,
  ADD COLUMN IF NOT EXISTS shortage_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status public.stock_closing_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_notes text;

-- 3) Backfill historical rows
UPDATE public.stock_closings
   SET expected_closing_stock = COALESCE(expected_closing_stock, system_stock),
       variance_weight        = COALESCE(variance_weight, difference),
       variance_type          = COALESCE(variance_type,
                                  CASE
                                    WHEN abs(COALESCE(difference,0)) < 0.001 THEN 'balanced'::public.stock_variance_type
                                    WHEN difference < 0 THEN 'shortage'::public.stock_variance_type
                                    ELSE 'surplus'::public.stock_variance_type
                                  END),
       status                 = 'finalized'::public.stock_closing_status,
       finalized_at           = COALESCE(finalized_at, created_at),
       finalized_by           = COALESCE(finalized_by, created_by)
 WHERE variance_type IS NULL OR status IS DISTINCT FROM 'finalized';

-- 4) Reversal RPC
CREATE OR REPLACE FUNCTION public.reverse_stock_closing(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.stock_closings;
  _adj record;
  _new_adj_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('stock_closing');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _c FROM public.stock_closings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closing not found'; END IF;
  IF _c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Closing already reversed'; END IF;

  -- Reverse any linked non-reversed adjustments by inserting an opposite entry
  FOR _adj IN
    SELECT * FROM public.stock_adjustments
      WHERE closing_id = _c.id
        AND reversed_at IS NULL
        AND original_adjustment_id IS NULL
  LOOP
    INSERT INTO public.stock_adjustments
      (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes,
       closing_id, created_by, original_adjustment_id, reversal_reason, reversal_notes)
    VALUES
      (_adj.tenant_id, CURRENT_DATE, _adj.meat_type, -1 * _adj.quantity_kg,
       _adj.reason, 'Reversal of closing adjustment — ' || p_reason,
       _c.id, auth.uid(), _adj.id, p_reason, p_notes)
    RETURNING id INTO _new_adj_id;

    UPDATE public.stock_adjustments
       SET reversed_at = now(), reversed_by = auth.uid(),
           reversal_reason = p_reason, reversal_notes = p_notes,
           reversal_adjustment_id = _new_adj_id
     WHERE id = _adj.id;
  END LOOP;

  UPDATE public.stock_closings
     SET reversed_at = now(),
         reversed_by = auth.uid(),
         reversal_reason = p_reason,
         reversal_notes = p_notes
   WHERE id = _c.id;

  RETURN _c.id;
END;
$function$;
