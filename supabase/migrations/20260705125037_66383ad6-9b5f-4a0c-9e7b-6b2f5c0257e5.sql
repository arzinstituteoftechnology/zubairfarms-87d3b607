
-- Business Configuration Center: master data tables

-- 1) Business profile (one row per tenant)
CREATE TABLE public.business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  company_name text,
  logo_url text,
  address text,
  phone text,
  whatsapp text,
  email text,
  ntn text,
  strn text,
  currency text NOT NULL DEFAULT 'PKR',
  time_zone text NOT NULL DEFAULT 'Asia/Karachi',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_profiles TO authenticated;
GRANT ALL ON public.business_profiles TO service_role;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bp_read" ON public.business_profiles FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id());
CREATE POLICY "bp_write_owner" ON public.business_profiles FOR ALL TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())))
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())));
CREATE TRIGGER trg_bp_touch BEFORE UPDATE ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_bp_tid BEFORE INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id();

-- 2) Generic settings-list tables (meat types, units, payment methods, expense categories, adjustment reasons)
CREATE TABLE public.meat_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE public.stock_adjustment_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Grants + RLS + triggers, one loop per table
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meat_types','units','payment_methods','expense_categories','stock_adjustment_reasons'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "%s_read" ON public.%I FOR SELECT TO authenticated USING (public.is_super_admin() OR tenant_id = public.current_tenant_id())', t, t);
    EXECUTE format('CREATE POLICY "%s_write_owner" ON public.%I FOR ALL TO authenticated USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid()))) WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())))', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_tid BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_current_tenant_id()', t, t);
  END LOOP;
END $$;

-- Audit trigger for settings changes
CREATE OR REPLACE FUNCTION public.audit_settings_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
  VALUES (lower(TG_TABLE_NAME) || '_' || lower(TG_OP), TG_TABLE_NAME,
    jsonb_build_object('op', TG_OP,
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END),
    auth.uid());
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_profiles','meat_types','units','payment_methods','expense_categories','stock_adjustment_reasons'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_settings_change()', t, t);
  END LOOP;
END $$;

-- Block deleting meat types referenced by historical records
CREATE OR REPLACE FUNCTION public.block_meat_type_delete_if_used()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _used int;
BEGIN
  SELECT (
    (SELECT count(*) FROM public.purchases         WHERE tenant_id = OLD.tenant_id AND meat_type = OLD.name) +
    (SELECT count(*) FROM public.supplies          WHERE tenant_id = OLD.tenant_id AND meat_type = OLD.name) +
    (SELECT count(*) FROM public.pos_sale_items    WHERE tenant_id = OLD.tenant_id AND meat_type = OLD.name) +
    (SELECT count(*) FROM public.stock_adjustments WHERE tenant_id = OLD.tenant_id AND meat_type = OLD.name) +
    (SELECT count(*) FROM public.stock_closings    WHERE tenant_id = OLD.tenant_id AND meat_type = OLD.name)
  ) INTO _used;
  IF _used > 0 THEN
    RAISE EXCEPTION 'Cannot delete meat type "%": % historical record(s) reference it. Disable it instead.', OLD.name, _used USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_meat_types_block_delete BEFORE DELETE ON public.meat_types
  FOR EACH ROW EXECUTE FUNCTION public.block_meat_type_delete_if_used();

-- Seed defaults for a tenant
CREATE OR REPLACE FUNCTION public.seed_tenant_settings(_tid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.business_profiles (tenant_id) VALUES (_tid) ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.meat_types (tenant_id, name, color, display_order) VALUES
    (_tid, 'Beef',    '#b91c1c', 1),
    (_tid, 'Mutton',  '#c2410c', 2),
    (_tid, 'Goat',    '#a16207', 3),
    (_tid, 'Chicken', '#facc15', 4),
    (_tid, 'Lamb',    '#dc2626', 5),
    (_tid, 'Buffalo', '#7c2d12', 6)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.units (tenant_id, code, name, display_order, is_system) VALUES
    (_tid, 'kg',    'Kilogram', 1, true),
    (_tid, 'g',     'Gram',     2, true),
    (_tid, 'piece', 'Piece',    3, true),
    (_tid, 'box',   'Box',      4, true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.payment_methods (tenant_id, code, name, display_order, is_system) VALUES
    (_tid, 'cash',       'Cash',       1, true),
    (_tid, 'bank',       'Bank',       2, true),
    (_tid, 'easypaisa',  'EasyPaisa',  3, true),
    (_tid, 'jazzcash',   'JazzCash',   4, true),
    (_tid, 'credit',     'Credit',     5, true),
    (_tid, 'partial',    'Partial',    6, true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.expense_categories (tenant_id, name, display_order) VALUES
    (_tid, 'Feed', 1), (_tid, 'Labour', 2), (_tid, 'Salary', 3),
    (_tid, 'Transport', 4), (_tid, 'Fuel', 5), (_tid, 'Utilities', 6),
    (_tid, 'Repairs', 7), (_tid, 'Medicine', 8), (_tid, 'Rent', 9), (_tid, 'Other', 10)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.stock_adjustment_reasons (tenant_id, code, name, display_order, is_system) VALUES
    (_tid, 'mortality',   'Mortality',   1, true),
    (_tid, 'weight_loss', 'Weight Loss', 2, true),
    (_tid, 'wastage',     'Wastage',     3, true),
    (_tid, 'damage',      'Damage',      4, true),
    (_tid, 'theft',       'Theft',       5, true),
    (_tid, 'other',       'Other',       6, true)
  ON CONFLICT DO NOTHING;
END $$;

-- Backfill for existing tenants
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_tenant_settings(r.id);
  END LOOP;
END $$;

-- Auto-seed on new tenant creation
CREATE OR REPLACE FUNCTION public.on_tenant_created_seed_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_tenant_settings(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tenants_seed_settings AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.on_tenant_created_seed_settings();
