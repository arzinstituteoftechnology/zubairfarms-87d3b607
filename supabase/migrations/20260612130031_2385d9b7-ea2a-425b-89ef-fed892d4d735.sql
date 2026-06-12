DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.farms;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.farms FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.shops;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.shops FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.customers;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.customer_payments;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.farm_payments;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.farm_payments FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.purchases;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.supplies;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.supplies FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.expenses;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.trucks;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.trucks FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.deliveries;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.pos_sales;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.pos_sales FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.pos_sale_items;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.pos_sale_items FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

DROP TRIGGER IF EXISTS enforce_current_tenant_id_before_insert ON public.settings;
CREATE TRIGGER enforce_current_tenant_id_before_insert BEFORE INSERT ON public.settings FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();