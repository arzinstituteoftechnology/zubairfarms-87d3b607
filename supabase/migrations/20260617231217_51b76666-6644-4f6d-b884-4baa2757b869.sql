
-- Login attempts table for rate limiting & audit
CREATE TABLE IF NOT EXISTS public.super_admin_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.super_admin_login_attempts TO anon, authenticated;
GRANT ALL ON public.super_admin_login_attempts TO service_role;
ALTER TABLE public.super_admin_login_attempts ENABLE ROW LEVEL SECURITY;

-- Nobody can read directly (audit only via super admin)
CREATE POLICY "super admin read attempts" ON public.super_admin_login_attempts
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- Anyone may insert an attempt row (called via RPC below)
CREATE POLICY "insert attempts" ON public.super_admin_login_attempts
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sa_login_email_time
  ON public.super_admin_login_attempts (lower(email), created_at DESC);

-- Public RPC: is there already a super admin? (no data leak)
CREATE OR REPLACE FUNCTION public.super_admin_exists()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = 'super_admin')
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_exists() TO anon, authenticated;

-- Rate-limit check: returns seconds remaining lockout, or 0 if allowed.
-- Lockout: 5 failed attempts in last 15 minutes => locked for 15 minutes from last failure.
CREATE OR REPLACE FUNCTION public.super_admin_login_lockout(_email text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fail_count int;
  _last_fail timestamptz;
  _remaining int;
BEGIN
  SELECT count(*), max(created_at)
    INTO _fail_count, _last_fail
  FROM public.super_admin_login_attempts
  WHERE lower(email) = lower(_email)
    AND success = false
    AND created_at > now() - interval '15 minutes';

  IF _fail_count >= 5 THEN
    _remaining := GREATEST(0, EXTRACT(EPOCH FROM (_last_fail + interval '15 minutes' - now()))::int);
    RETURN _remaining;
  END IF;
  RETURN 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_login_lockout(text) TO anon, authenticated;

-- Record an attempt + log to activity_logs
CREATE OR REPLACE FUNCTION public.record_super_admin_login_attempt(_email text, _success boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.super_admin_login_attempts (email, success)
  VALUES (_email, _success);

  INSERT INTO public.activity_logs (action, entity, metadata)
  VALUES (
    CASE WHEN _success THEN 'super_admin_login_success' ELSE 'super_admin_login_failure' END,
    'super_admin',
    jsonb_build_object('email', _email)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_super_admin_login_attempt(text, boolean) TO anon, authenticated;

-- Harden bootstrap_super_admin: already returns false if one exists; add explicit guard + log
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE existing int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(*) INTO existing FROM public.user_roles WHERE role::text = 'super_admin';
  IF existing > 0 THEN
    -- Permanently disabled once a super admin exists
    INSERT INTO public.activity_logs (action, entity, metadata, user_id)
    VALUES ('super_admin_bootstrap_blocked', 'super_admin',
            jsonb_build_object('attempted_by', auth.uid()), auth.uid());
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'super_admin'::public.app_role)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.activity_logs (action, entity, metadata, user_id)
  VALUES ('super_admin_bootstrap', 'super_admin',
          jsonb_build_object('user_id', auth.uid()), auth.uid());
  RETURN true;
END;
$$;
