ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS shops_deleted_at_idx ON public.shops (deleted_at);
CREATE INDEX IF NOT EXISTS farms_deleted_at_idx ON public.farms (deleted_at);