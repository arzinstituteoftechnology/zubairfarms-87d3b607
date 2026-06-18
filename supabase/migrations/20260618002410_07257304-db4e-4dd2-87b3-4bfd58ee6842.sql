
-- Drop existing policies on subscription_plans and recreate per-command, explicit
DROP POLICY IF EXISTS "read plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "sa manage plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Super Admins can view all plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Super Admins can create plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Super Admins can update plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Super Admins can delete plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Anyone authenticated can view plans" ON public.subscription_plans;

-- Ensure RLS + grants
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_plans TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

-- Tenant users (and anyone authenticated) can read plans
CREATE POLICY "Anyone authenticated can view plans"
  ON public.subscription_plans FOR SELECT
  TO authenticated
  USING (true);

-- Super Admin: full write access
CREATE POLICY "Super Admins can create plans"
  ON public.subscription_plans FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super Admins can update plans"
  ON public.subscription_plans FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super Admins can delete plans"
  ON public.subscription_plans FOR DELETE
  TO authenticated
  USING (public.is_super_admin());
