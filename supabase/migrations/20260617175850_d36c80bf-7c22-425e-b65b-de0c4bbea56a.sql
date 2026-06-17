ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS customers_module_enabled boolean NOT NULL DEFAULT false;
GRANT SELECT ON public.system_settings TO anon, authenticated;