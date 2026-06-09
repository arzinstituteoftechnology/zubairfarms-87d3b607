ALTER FUNCTION public.prevent_purchase_farm_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_supply_shop_change() SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.prevent_purchase_farm_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_supply_shop_change() FROM PUBLIC, anon, authenticated;