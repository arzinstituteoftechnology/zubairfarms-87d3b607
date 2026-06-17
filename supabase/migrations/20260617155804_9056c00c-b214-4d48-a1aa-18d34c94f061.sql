
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.bootstrap_super_admin()',
    'public.current_tenant_id()',
    'public.has_role(uuid, public.app_role)',
    'public.is_super_admin()',
    'public.is_business_user(uuid)',
    'public.tenant_has_active_subscription(uuid)',
    'public.sync_recovery_to_ledger()',
    'public.stamp_edited_audit()',
    'public.enforce_current_tenant_id()',
    'public.handle_new_user()',
    'public.touch_updated_at()',
    'public.prevent_supply_shop_change()',
    'public.prevent_purchase_farm_change()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skipping missing function %', fn;
    END;
  END LOOP;
END$$;
