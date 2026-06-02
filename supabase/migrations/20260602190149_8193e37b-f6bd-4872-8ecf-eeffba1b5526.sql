ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'credit';

CREATE INDEX IF NOT EXISTS idx_purchases_farm_date ON public.purchases(farm_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_farm_payments_farm_date ON public.farm_payments(farm_id, payment_date DESC);