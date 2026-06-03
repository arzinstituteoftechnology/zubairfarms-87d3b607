
-- Helper: any business role (admin or staff)
CREATE OR REPLACE FUNCTION public.is_business_user(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin'::app_role, 'staff'::app_role)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_business_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_user(uuid) TO authenticated, service_role;

-- Revoke EXECUTE on trigger-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Rewrite permissive SELECT/INSERT policies across business tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'farms','shops','customers','trucks',
    'purchases','supplies','customer_payments','farm_payments',
    'expenses','deliveries','pos_sales','pos_sale_items'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop existing SELECT and INSERT policies on the table
    FOR pol IN
      SELECT policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd IN ('SELECT','INSERT')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "business read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.is_business_user(auth.uid()))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "business insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.is_business_user(auth.uid()))',
      t
    );
  END LOOP;
END $$;
