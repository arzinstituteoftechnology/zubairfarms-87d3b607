
-- 1. Add description column to reasons table
ALTER TABLE public.stock_adjustment_reasons
  ADD COLUMN IF NOT EXISTS description text;

-- 2. Add reason_id FK column to stock_adjustments and stock_closings
ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS reason_id uuid REFERENCES public.stock_adjustment_reasons(id) ON DELETE RESTRICT;

ALTER TABLE public.stock_closings
  ADD COLUMN IF NOT EXISTS reason_id uuid REFERENCES public.stock_adjustment_reasons(id) ON DELETE RESTRICT;

-- 3. Convert reason columns from enum to text (preserves values as text codes)
ALTER TABLE public.stock_adjustments
  ALTER COLUMN reason DROP NOT NULL,
  ALTER COLUMN reason TYPE text USING reason::text;

ALTER TABLE public.stock_closings
  ALTER COLUMN reason TYPE text USING reason::text;

-- 4. Backfill reason_id from (tenant_id, reason code)
UPDATE public.stock_adjustments a
   SET reason_id = r.id
  FROM public.stock_adjustment_reasons r
 WHERE a.reason_id IS NULL
   AND a.tenant_id = r.tenant_id
   AND a.reason = r.code;

UPDATE public.stock_closings c
   SET reason_id = r.id
  FROM public.stock_adjustment_reasons r
 WHERE c.reason_id IS NULL
   AND c.tenant_id = r.tenant_id
   AND c.reason = r.code;

-- 5. Drop the enum type now that no columns depend on it
DROP TYPE IF EXISTS public.stock_adjustment_reason;

-- 6. Trigger: block deleting reasons used in history — allow archive only
CREATE OR REPLACE FUNCTION public.block_reason_delete_if_used()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _used int;
BEGIN
  SELECT (
    (SELECT count(*) FROM public.stock_adjustments
       WHERE tenant_id = OLD.tenant_id AND (reason_id = OLD.id OR reason = OLD.code)) +
    (SELECT count(*) FROM public.stock_closings
       WHERE tenant_id = OLD.tenant_id AND (reason_id = OLD.id OR reason = OLD.code))
  ) INTO _used;
  IF _used > 0 THEN
    RAISE EXCEPTION 'Cannot delete reason "%": % historical record(s) reference it. Archive it instead.', OLD.name, _used
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_block_reason_delete_if_used ON public.stock_adjustment_reasons;
CREATE TRIGGER trg_block_reason_delete_if_used
  BEFORE DELETE ON public.stock_adjustment_reasons
  FOR EACH ROW EXECUTE FUNCTION public.block_reason_delete_if_used();

-- 7. Helpful indexes
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_reason_id ON public.stock_adjustments(reason_id);
CREATE INDEX IF NOT EXISTS idx_stock_closings_reason_id ON public.stock_closings(reason_id);
