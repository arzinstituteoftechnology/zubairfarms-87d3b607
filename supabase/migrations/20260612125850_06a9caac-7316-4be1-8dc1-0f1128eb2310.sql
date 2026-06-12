CREATE OR REPLACE FUNCTION public.enforce_current_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated. Please sign in again.' USING ERRCODE = '42501';
  END IF;

  _tenant_id := public.current_tenant_id();

  IF _tenant_id IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Account is not linked to a client. Please sign in with a tenant admin account created by the super admin.' USING ERRCODE = '42501';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := _tenant_id;
  END IF;

  IF NOT public.is_super_admin() AND NEW.tenant_id <> _tenant_id THEN
    RAISE EXCEPTION 'Cannot create records for another client account.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() AND NOT public.tenant_has_active_subscription(_tenant_id) THEN
    RAISE EXCEPTION 'Client subscription is not active. Please contact the super admin.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enforce_current_tenant_id() TO authenticated, service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'farms','shops','customers','customer_payments','farm_payments',
    'purchases','supplies','expenses','trucks','deliveries',
    'pos_sales','pos_sale_items','settings'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id()',
      t
    );
  END LOOP;
END$$;