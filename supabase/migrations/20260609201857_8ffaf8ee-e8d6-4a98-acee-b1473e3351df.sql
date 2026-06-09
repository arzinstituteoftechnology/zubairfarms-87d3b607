-- Lock farm_id on purchases and shop_id on supplies after creation
CREATE OR REPLACE FUNCTION public.prevent_purchase_farm_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.farm_id IS DISTINCT FROM OLD.farm_id THEN
    RAISE EXCEPTION 'farm_id is immutable after purchase record creation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_purchase_farm ON public.purchases;
CREATE TRIGGER lock_purchase_farm
BEFORE UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.prevent_purchase_farm_change();

CREATE OR REPLACE FUNCTION public.prevent_supply_shop_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
    RAISE EXCEPTION 'shop_id is immutable after supply record creation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_supply_shop ON public.supplies;
CREATE TRIGGER lock_supply_shop
BEFORE UPDATE ON public.supplies
FOR EACH ROW EXECUTE FUNCTION public.prevent_supply_shop_change();