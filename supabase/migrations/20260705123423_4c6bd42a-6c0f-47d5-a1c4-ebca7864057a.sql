
-- 1. tenant_users: status + role migration
ALTER TABLE public.tenant_users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.tenant_users
  DROP CONSTRAINT IF EXISTS tenant_users_status_check;
ALTER TABLE public.tenant_users
  ADD CONSTRAINT tenant_users_status_check CHECK (status IN ('active','disabled'));

ALTER TABLE public.tenant_users DROP CONSTRAINT IF EXISTS tenant_users_tenant_role_check;
ALTER TABLE public.tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;

UPDATE public.tenant_users SET tenant_role = 'owner' WHERE tenant_role IN ('admin','staff');

ALTER TABLE public.tenant_users
  ADD CONSTRAINT tenant_users_tenant_role_check
  CHECK (tenant_role IN ('owner','manager','cashier','data_entry','read_only'));

ALTER TABLE public.tenant_users ALTER COLUMN tenant_role SET DEFAULT 'owner';

-- 2. role_permissions
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role text NOT NULL,
  module text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, module, action),
  CHECK (role IN ('owner','manager','cashier','data_entry','read_only')),
  CHECK (module IN ('dashboard','pos','farms','shops','supplier_ledger','shop_ledger','daily_recovery','purchases','supplies','expenses','trucks','deliveries','inventory','stock_closing','closing_history','mortality_register','reports','settings','backup_restore','users')),
  CHECK (action IN ('view','create','edit','delete','reverse','print','export','approve','reset'))
);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- 3. user_permission_overrides
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  module text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module, action),
  CHECK (module IN ('dashboard','pos','farms','shops','supplier_ledger','shop_ledger','daily_recovery','purchases','supplies','expenses','trucks','deliveries','inventory','stock_closing','closing_history','mortality_register','reports','settings','backup_restore','users')),
  CHECK (action IN ('view','create','edit','delete','reverse','print','export','approve','reset'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permission_overrides TO authenticated;
GRANT ALL ON public.user_permission_overrides TO service_role;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- 4. Helpers
CREATE OR REPLACE FUNCTION public.is_tenant_owner(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_users WHERE user_id = _uid AND tenant_role = 'owner' AND status = 'active')
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid, _module text, _action text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tu public.tenant_users; _override boolean; _role_allowed boolean;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF public.is_super_admin() THEN RETURN true; END IF;
  SELECT * INTO _tu FROM public.tenant_users WHERE user_id = _uid LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _tu.status <> 'active' THEN RETURN false; END IF;
  IF _tu.tenant_role = 'owner' THEN RETURN true; END IF;
  SELECT allowed INTO _override FROM public.user_permission_overrides
    WHERE user_id = _uid AND module = _module AND action = _action;
  IF FOUND THEN RETURN _override; END IF;
  SELECT allowed INTO _role_allowed FROM public.role_permissions
    WHERE role = _tu.tenant_role AND module = _module AND action = _action;
  RETURN COALESCE(_role_allowed, false);
END; $$;

CREATE OR REPLACE FUNCTION public.assert_permission(_module text, _action text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), _module, _action) THEN
    INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
    VALUES ('unauthorized_action_attempt', _module,
      jsonb_build_object('required_action', _action, 'user_id', auth.uid()), auth.uid());
    RAISE EXCEPTION 'You do not have permission to % on %', _action, _module USING ERRCODE = '42501';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_can_reverse_module(_module text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_super_admin() OR public.is_tenant_owner(auth.uid()) THEN RETURN; END IF;
  IF NOT public.has_permission(auth.uid(), _module, 'reverse') THEN
    INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
    VALUES ('unauthorized_action_attempt', _module,
      jsonb_build_object('required_action','reverse'), auth.uid());
    RAISE EXCEPTION 'You do not have permission to reverse % records', _module USING ERRCODE = '42501';
  END IF;
END; $$;

-- 5. RLS policies
DROP POLICY IF EXISTS "Authenticated can read role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated can read role permissions"
  ON public.role_permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Owners can manage role permissions" ON public.role_permissions;
CREATE POLICY "Owners can manage role permissions"
  ON public.role_permissions FOR ALL TO authenticated
  USING (public.is_tenant_owner(auth.uid()) OR public.is_super_admin())
  WITH CHECK (public.is_tenant_owner(auth.uid()) OR public.is_super_admin());

DROP POLICY IF EXISTS "Users see overrides in tenant" ON public.user_permission_overrides;
CREATE POLICY "Users see overrides in tenant"
  ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin()
         OR (public.is_tenant_owner(auth.uid()) AND tenant_id = public.current_tenant_id()));
DROP POLICY IF EXISTS "Owners manage overrides in tenant" ON public.user_permission_overrides;
CREATE POLICY "Owners manage overrides in tenant"
  ON public.user_permission_overrides FOR ALL TO authenticated
  USING (public.is_super_admin()
         OR (public.is_tenant_owner(auth.uid()) AND tenant_id = public.current_tenant_id()))
  WITH CHECK (public.is_super_admin()
         OR (public.is_tenant_owner(auth.uid()) AND tenant_id = public.current_tenant_id()));

-- 6. tenant_users guard trigger
CREATE OR REPLACE FUNCTION public.guard_tenant_users_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner_count int;
BEGIN
  IF public.is_super_admin() OR auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.tenant_role = 'owner' THEN
      SELECT count(*) INTO _owner_count FROM public.tenant_users
        WHERE tenant_id = OLD.tenant_id AND tenant_role = 'owner'
          AND status = 'active' AND id <> OLD.id;
      IF _owner_count = 0 AND (TG_OP='DELETE'
          OR (TG_OP='UPDATE' AND (NEW.tenant_role <> 'owner' OR NEW.status <> 'active'))) THEN
        RAISE EXCEPTION 'Cannot remove or disable the last Owner of this account' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND (NEW.tenant_role <> OLD.tenant_role OR NEW.status <> OLD.status)
       AND NOT public.is_tenant_owner(auth.uid()) THEN
      RAISE EXCEPTION 'Only Owner can change roles or status' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS tenant_users_guard ON public.tenant_users;
CREATE TRIGGER tenant_users_guard BEFORE UPDATE OR DELETE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_users_write();

-- 7. Seed defaults
WITH modules(m) AS (VALUES
  ('dashboard'),('pos'),('farms'),('shops'),('supplier_ledger'),('shop_ledger'),
  ('daily_recovery'),('purchases'),('supplies'),('expenses'),('trucks'),('deliveries'),
  ('inventory'),('stock_closing'),('closing_history'),('mortality_register'),
  ('reports'),('settings'),('backup_restore'),('users')),
actions(a) AS (VALUES
  ('view'),('create'),('edit'),('delete'),('reverse'),('print'),('export'),('approve'),('reset'))
INSERT INTO public.role_permissions (role, module, action, allowed)
SELECT 'owner', m, a, true FROM modules CROSS JOIN actions
ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.role_permissions (role, module, action, allowed) VALUES
  ('manager','dashboard','view',true),('manager','dashboard','print',true),('manager','dashboard','export',true),
  ('manager','pos','view',true),('manager','pos','create',true),('manager','pos','edit',true),('manager','pos','print',true),('manager','pos','export',true),
  ('manager','farms','view',true),('manager','farms','create',true),('manager','farms','edit',true),('manager','farms','print',true),('manager','farms','export',true),
  ('manager','shops','view',true),('manager','shops','create',true),('manager','shops','edit',true),('manager','shops','print',true),('manager','shops','export',true),
  ('manager','supplier_ledger','view',true),('manager','supplier_ledger','create',true),('manager','supplier_ledger','edit',true),('manager','supplier_ledger','print',true),('manager','supplier_ledger','export',true),('manager','supplier_ledger','approve',true),
  ('manager','shop_ledger','view',true),('manager','shop_ledger','create',true),('manager','shop_ledger','edit',true),('manager','shop_ledger','print',true),('manager','shop_ledger','export',true),('manager','shop_ledger','approve',true),
  ('manager','daily_recovery','view',true),('manager','daily_recovery','create',true),('manager','daily_recovery','edit',true),('manager','daily_recovery','print',true),('manager','daily_recovery','export',true),
  ('manager','purchases','view',true),('manager','purchases','create',true),('manager','purchases','edit',true),('manager','purchases','print',true),('manager','purchases','export',true),('manager','purchases','approve',true),
  ('manager','supplies','view',true),('manager','supplies','create',true),('manager','supplies','edit',true),('manager','supplies','print',true),('manager','supplies','export',true),('manager','supplies','approve',true),
  ('manager','expenses','view',true),('manager','expenses','create',true),('manager','expenses','edit',true),('manager','expenses','print',true),('manager','expenses','export',true),
  ('manager','trucks','view',true),('manager','trucks','create',true),('manager','trucks','edit',true),('manager','trucks','print',true),('manager','trucks','export',true),
  ('manager','deliveries','view',true),('manager','deliveries','create',true),('manager','deliveries','edit',true),('manager','deliveries','print',true),('manager','deliveries','export',true),
  ('manager','inventory','view',true),('manager','inventory','print',true),('manager','inventory','export',true),
  ('manager','stock_closing','view',true),('manager','stock_closing','create',true),('manager','stock_closing','edit',true),('manager','stock_closing','print',true),('manager','stock_closing','export',true),('manager','stock_closing','approve',true),
  ('manager','closing_history','view',true),('manager','closing_history','print',true),('manager','closing_history','export',true),
  ('manager','mortality_register','view',true),('manager','mortality_register','create',true),('manager','mortality_register','edit',true),('manager','mortality_register','print',true),('manager','mortality_register','export',true),
  ('manager','reports','view',true),('manager','reports','print',true),('manager','reports','export',true),
  ('manager','settings','view',true),
  ('manager','backup_restore','view',true)
ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.role_permissions (role, module, action, allowed) VALUES
  ('cashier','dashboard','view',true),
  ('cashier','pos','view',true),('cashier','pos','create',true),('cashier','pos','print',true),
  ('cashier','daily_recovery','view',true),('cashier','daily_recovery','create',true),('cashier','daily_recovery','print',true),
  ('cashier','shop_ledger','view',true),('cashier','shop_ledger','print',true),
  ('cashier','reports','view',true),('cashier','reports','print',true)
ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.role_permissions (role, module, action, allowed) VALUES
  ('data_entry','dashboard','view',true),
  ('data_entry','purchases','view',true),('data_entry','purchases','create',true),
  ('data_entry','supplies','view',true),('data_entry','supplies','create',true),
  ('data_entry','expenses','view',true),('data_entry','expenses','create',true),
  ('data_entry','farms','view',true),('data_entry','farms','create',true),
  ('data_entry','shops','view',true),('data_entry','shops','create',true),
  ('data_entry','pos','view',true),('data_entry','pos','create',true),
  ('data_entry','stock_closing','view',true),('data_entry','stock_closing','create',true),
  ('data_entry','mortality_register','view',true),('data_entry','mortality_register','create',true),
  ('data_entry','inventory','view',true)
ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.role_permissions (role, module, action, allowed) VALUES
  ('read_only','dashboard','view',true),
  ('read_only','reports','view',true),
  ('read_only','shop_ledger','view',true),
  ('read_only','supplier_ledger','view',true),
  ('read_only','inventory','view',true),
  ('read_only','closing_history','view',true)
ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 8. Patch reverse_* RPCs
CREATE OR REPLACE FUNCTION public.reverse_purchase(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _p public.purchases; _new_id uuid; _net numeric;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('purchases');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _p FROM public.purchases WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
  IF _p.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Purchase already reversed'; END IF;
  _net := COALESCE(_p.total_amount, 0) - COALESCE(_p.paid_amount, 0);
  INSERT INTO public.supplier_ledger_entries
    (tenant_id, supplier_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES (_p.tenant_id, _p.farm_id, 'reversed_purchase', CURRENT_DATE,
     'Reversal of purchase (' || _p.purchase_date || ', ' || COALESCE(_p.meat_type, '') || ', net ' || _net || ') — ' || p_reason,
     _net, auth.uid(), p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.purchases SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_ledger_entry_id = _new_id WHERE id = _p.id;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reverse_supply(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _s public.supplies; _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('supplies');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _s FROM public.supplies WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supply not found'; END IF;
  IF _s.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Supply already reversed'; END IF;
  INSERT INTO public.shop_ledger_entries
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES (_s.tenant_id, _s.shop_id, 'reversed_supply', CURRENT_DATE,
     'Reversal of supply (' || _s.supply_date || ', ' || COALESCE(_s.meat_type, '') || ') — ' || p_reason,
     COALESCE(_s.total_amount, 0), auth.uid(), p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.supplies SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_ledger_entry_id = _new_id WHERE id = _s.id;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reverse_farm_payment(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _fp public.farm_payments; _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('supplier_ledger');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _fp FROM public.farm_payments WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF _fp.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Payment already reversed'; END IF;
  INSERT INTO public.supplier_ledger_entries
    (tenant_id, supplier_id, entry_type, entry_date, description, amount, created_by, reversal_reason, reversal_notes)
  VALUES (_fp.tenant_id, _fp.farm_id, 'reversed_payment', CURRENT_DATE,
     'Reversal of payment (' || _fp.payment_date || ', ' || COALESCE(_fp.method, '') || ') — ' || p_reason,
     COALESCE(_fp.amount, 0), auth.uid(), p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.farm_payments SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_ledger_entry_id = _new_id WHERE id = _fp.id;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reverse_shop_recovery(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r public.shop_recoveries; _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('daily_recovery');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _r FROM public.shop_recoveries WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery not found'; END IF;
  IF _r.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Recovery already reversed'; END IF;
  INSERT INTO public.shop_ledger_entries
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, original_entry_id, reversal_reason, reversal_notes)
  VALUES (_r.tenant_id, _r.shop_id, 'reversed_recovery', CURRENT_DATE,
     'Reversal of recovery (' || _r.recovery_date || ', ' || _r.payment_method || ')'
       || COALESCE(' — Collector: ' || NULLIF(_r.collected_by, ''), '') || ' — ' || p_reason,
     COALESCE(_r.amount, 0), auth.uid(), _r.ledger_entry_id, p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.shop_recoveries SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_ledger_entry_id = _new_id WHERE id = _r.id;
  UPDATE public.shop_ledger_entries SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_entry_id = _new_id
    WHERE id = _r.ledger_entry_id AND reversed_at IS NULL;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reverse_shop_ledger_entry(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _orig public.shop_ledger_entries; _new_id uuid; _new_type public.shop_ledger_type;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('shop_ledger');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _orig FROM public.shop_ledger_entries WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger entry not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF _orig.entry_type::text LIKE 'reversed_%' THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;
  _new_type := ('reversed_' || _orig.entry_type::text)::public.shop_ledger_type;
  INSERT INTO public.shop_ledger_entries
    (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by, original_entry_id, reversal_reason, reversal_notes)
  VALUES (_orig.tenant_id, _orig.shop_id, _new_type, CURRENT_DATE,
     'Reversal of ' || _orig.entry_type::text || ' (' || _orig.entry_date || ') — ' || p_reason,
     _orig.amount, auth.uid(), _orig.id, p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.shop_ledger_entries SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_entry_id = _new_id WHERE id = _orig.id;
  IF _orig.entry_type::text = 'recovery' THEN
    UPDATE public.shop_recoveries
      SET reversed_at = COALESCE(reversed_at, now()), reversed_by = COALESCE(reversed_by, auth.uid()),
          reversal_reason = COALESCE(reversal_reason, p_reason), reversal_notes = COALESCE(reversal_notes, p_notes),
          reversal_ledger_entry_id = COALESCE(reversal_ledger_entry_id, _new_id)
      WHERE ledger_entry_id = _orig.id;
  END IF;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reverse_supplier_ledger_entry(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _orig public.supplier_ledger_entries; _new_id uuid; _new_type public.supplier_ledger_type;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('supplier_ledger');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _orig FROM public.supplier_ledger_entries WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger entry not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF _orig.entry_type::text LIKE 'reversed_%' THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;
  _new_type := ('reversed_' || _orig.entry_type::text)::public.supplier_ledger_type;
  INSERT INTO public.supplier_ledger_entries
    (tenant_id, supplier_id, entry_type, entry_date, description, amount, created_by, original_entry_id, reversal_reason, reversal_notes)
  VALUES (_orig.tenant_id, _orig.supplier_id, _new_type, CURRENT_DATE,
     'Reversal of ' || _orig.entry_type::text || ' (' || _orig.entry_date || ') — ' || p_reason,
     _orig.amount, auth.uid(), _orig.id, p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.supplier_ledger_entries SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_entry_id = _new_id WHERE id = _orig.id;
  RETURN _new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reverse_stock_adjustment(p_id uuid, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _orig public.stock_adjustments; _new_id uuid;
BEGIN
  PERFORM public._assert_can_reverse();
  PERFORM public.assert_can_reverse_module('stock_closing');
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Reversal reason is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _orig FROM public.stock_adjustments WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF _orig.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Adjustment already reversed'; END IF;
  IF _orig.original_adjustment_id IS NOT NULL THEN RAISE EXCEPTION 'Cannot reverse a reversal entry'; END IF;
  INSERT INTO public.stock_adjustments
    (tenant_id, adjustment_date, meat_type, quantity_kg, reason, notes, closing_id, created_by, original_adjustment_id, reversal_reason, reversal_notes)
  VALUES (_orig.tenant_id, CURRENT_DATE, _orig.meat_type, -_orig.quantity_kg, _orig.reason,
     'Reversal of adjustment (' || _orig.adjustment_date || ') — ' || p_reason,
     _orig.closing_id, auth.uid(), _orig.id, p_reason, p_notes) RETURNING id INTO _new_id;
  UPDATE public.stock_adjustments SET reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_notes = p_notes, reversal_adjustment_id = _new_id WHERE id = _orig.id;
  RETURN _new_id;
END; $function$;

-- 9. Central permission trigger on major business tables
CREATE OR REPLACE FUNCTION public.enforce_permission_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _module text; _action text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.is_super_admin() THEN RETURN COALESCE(NEW, OLD); END IF;
  _module := TG_ARGV[0];
  _action := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'edit' WHEN 'DELETE' THEN 'delete' END;
  IF NOT public.has_permission(auth.uid(), _module, _action) THEN
    INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
    VALUES ('unauthorized_action_attempt', _module,
      jsonb_build_object('required_action', _action, 'op', TG_OP), auth.uid());
    RAISE EXCEPTION 'You do not have permission to % on %', _action, _module USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DO $$
DECLARE
  mapping text[][] := ARRAY[
    ARRAY['farms','farms'], ARRAY['shops','shops'], ARRAY['customers','shops'],
    ARRAY['trucks','trucks'], ARRAY['deliveries','deliveries'],
    ARRAY['purchases','purchases'], ARRAY['supplies','supplies'], ARRAY['expenses','expenses'],
    ARRAY['farm_payments','supplier_ledger'], ARRAY['customer_payments','shop_ledger'],
    ARRAY['payments','shop_ledger'], ARRAY['shop_recoveries','daily_recovery'],
    ARRAY['stock_closings','stock_closing'], ARRAY['stock_adjustments','stock_closing'],
    ARRAY['pos_sales','pos'], ARRAY['pos_sale_items','pos']
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(mapping,1) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_perm_%s ON public.%s', mapping[i][1], mapping[i][1]);
    EXECUTE format('CREATE TRIGGER enforce_perm_%s BEFORE INSERT OR UPDATE OR DELETE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.enforce_permission_trigger(%L)', mapping[i][1], mapping[i][1], mapping[i][2]);
  END LOOP;
END $$;

-- 10. Audit triggers on permission/user tables
CREATE OR REPLACE FUNCTION public.audit_perm_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
  VALUES (lower(TG_TABLE_NAME) || '_' || lower(TG_OP), TG_TABLE_NAME,
    jsonb_build_object('op', TG_OP,
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END),
    auth.uid());
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS audit_tenant_users ON public.tenant_users;
CREATE TRIGGER audit_tenant_users AFTER INSERT OR UPDATE OR DELETE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.audit_perm_changes();
DROP TRIGGER IF EXISTS audit_role_perms ON public.role_permissions;
CREATE TRIGGER audit_role_perms AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_perm_changes();
DROP TRIGGER IF EXISTS audit_user_overrides ON public.user_permission_overrides;
CREATE TRIGGER audit_user_overrides AFTER INSERT OR UPDATE OR DELETE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_perm_changes();
