
TRUNCATE
  public.customer_payments, public.farm_payments,
  public.pos_sale_items, public.pos_sales,
  public.deliveries, public.supplies, public.purchases,
  public.expenses, public.trucks, public.customers,
  public.shops, public.farms, public.settings,
  public.user_roles, public.profiles
  RESTART IDENTITY CASCADE;

DELETE FROM auth.users;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  farm_name text,
  owner_name text NOT NULL,
  mobile text,
  email text NOT NULL,
  country text,
  city text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;

CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('trial','monthly','yearly')),
  price numeric(10,2) NOT NULL DEFAULT 0,
  duration_days int NOT NULL,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','suspended','trial','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_name text NOT NULL,
  amount numeric(10,2) NOT NULL,
  payment_date date NOT NULL DEFAULT current_date,
  expiry_date date,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending','overdue','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

CREATE TABLE public.tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_role text NOT NULL DEFAULT 'admin' CHECK (tenant_role IN ('admin','manager','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX idx_tenant_users_user ON public.tenant_users(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_users TO authenticated;
GRANT ALL ON public.tenant_users TO service_role;

CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  action text NOT NULL,
  entity text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_logs_created ON public.activity_logs(created_at DESC);
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;

CREATE TABLE public.system_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name text NOT NULL DEFAULT 'Poultry ERP',
  currency text NOT NULL DEFAULT 'USD',
  default_trial_days int NOT NULL DEFAULT 15,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.system_settings (id) VALUES (1);
GRANT SELECT ON public.system_settings TO anon, authenticated;
GRANT ALL ON public.system_settings TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'farms','shops','customers','customer_payments','farm_payments',
    'purchases','supplies','expenses','trucks','deliveries',
    'pos_sales','pos_sale_items','settings'
  ]) LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE',
      t
    );
    EXECUTE format('CREATE INDEX idx_%s_tenant ON public.%I(tenant_id)', t, t);
  END LOOP;
END$$;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS row_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.settings ADD PRIMARY KEY (row_id);
ALTER TABLE public.settings ADD CONSTRAINT settings_tenant_unique UNIQUE (tenant_id);

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid() LIMIT 1
$$;

-- cast role to text to avoid "unsafe use of new enum value" during this migration
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT COUNT(*) INTO existing FROM public.user_roles WHERE role::text = 'super_admin';
  IF existing = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'super_admin'::public.app_role)
    ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sa all tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "tenant read own" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id());

CREATE POLICY "read plans" ON public.subscription_plans FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "sa manage plans" ON public.subscription_plans FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY "sa all subs" ON public.subscriptions FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "tenant read own sub" ON public.subscriptions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "sa all payments" ON public.payments FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "tenant read own payments" ON public.payments FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "sa all tenant_users" ON public.tenant_users FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "self read tenant_user" ON public.tenant_users FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "sa read logs" ON public.activity_logs FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "tenant read own logs" ON public.activity_logs FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "auth insert logs" ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

CREATE POLICY "read settings" ON public.system_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "sa write settings" ON public.system_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'farms','shops','customers','customer_payments','farm_payments',
    'purchases','supplies','expenses','trucks','deliveries',
    'pos_sales','pos_sale_items','settings'
  ]) LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "tenant all %1$s" ON public.%1$I FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())',
      t
    );
    EXECUTE format(
      'CREATE POLICY "sa read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.is_super_admin())',
      t
    );
  END LOOP;
END$$;

DROP POLICY IF EXISTS "Profiles selectable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_super_admin());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "sa manage profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users see own roles" ON public.user_roles;
CREATE POLICY "self read roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());
CREATE POLICY "sa manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

INSERT INTO public.subscription_plans (name, billing_cycle, price, duration_days, features) VALUES
  ('Free Trial',          'trial',   0,    15,  '["Basic ERP access"]'::jsonb),
  ('Basic Monthly',       'monthly', 9.99, 30,  '["Up to 2 farms","Basic reports"]'::jsonb),
  ('Basic Yearly',        'yearly',  99,   365, '["Up to 2 farms","Basic reports","2 months free"]'::jsonb),
  ('Professional Monthly','monthly', 29,   30,  '["Up to 10 farms","Advanced reports","Multi-user"]'::jsonb),
  ('Professional Yearly', 'yearly',  290,  365, '["Up to 10 farms","Advanced reports","Multi-user","2 months free"]'::jsonb),
  ('Enterprise Monthly',  'monthly', 99,   30,  '["Unlimited farms","All features","Priority support"]'::jsonb),
  ('Enterprise Yearly',   'yearly',  990,  365, '["Unlimited farms","All features","Priority support","2 months free"]'::jsonb);

CREATE TRIGGER trg_tenants_uat BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_plans_uat BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_subs_uat BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_payments_uat BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_syssettings_uat BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
