ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS farm_id uuid REFERENCES public.farms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bird_count integer;

CREATE INDEX IF NOT EXISTS stock_adjustments_farm_id_idx ON public.stock_adjustments(farm_id);
CREATE INDEX IF NOT EXISTS stock_adjustments_shop_id_idx ON public.stock_adjustments(shop_id);