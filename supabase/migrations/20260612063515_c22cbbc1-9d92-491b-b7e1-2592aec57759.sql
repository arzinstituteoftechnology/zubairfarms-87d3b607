
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'farms','shops','customers','customer_payments','farm_payments',
    'purchases','supplies','expenses','trucks','deliveries',
    'pos_sales','pos_sale_items','settings'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id()', t);
  END LOOP;
END$$;
