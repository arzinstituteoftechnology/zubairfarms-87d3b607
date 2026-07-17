
-- Plans: quota + capability fields
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS max_users int,
  ADD COLUMN IF NOT EXISTS max_farms int,
  ADD COLUMN IF NOT EXISTS max_shops int,
  ADD COLUMN IF NOT EXISTS max_trucks int,
  ADD COLUMN IF NOT EXISTS max_storage_mb int,
  ADD COLUMN IF NOT EXISTS backup_frequency text,
  ADD COLUMN IF NOT EXISTS report_access boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS audit_access boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS api_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS support_priority text NOT NULL DEFAULT 'standard';

-- Subscriptions: license + lifecycle
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS license_key text UNIQUE,
  ADD COLUMN IF NOT EXISTS issue_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS grace_period_days int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_days int;

-- Subscription events
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subscription_id uuid,
  event_type text NOT NULL CHECK (event_type IN
    ('activated','renewed','upgraded','downgraded','expired','suspended','cancelled','restored','trial_started','trial_expired','notice_sent')),
  from_plan_id uuid,
  to_plan_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sub_events_tenant ON public.subscription_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sub_events_type ON public.subscription_events(event_type);

GRANT SELECT ON public.subscription_events TO authenticated;
GRANT ALL ON public.subscription_events TO service_role;

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner or sa read sub events" ON public.subscription_events;
CREATE POLICY "owner or sa read sub events" ON public.subscription_events
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())));

DROP POLICY IF EXISTS "sa manage sub events" ON public.subscription_events;
CREATE POLICY "sa manage sub events" ON public.subscription_events
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- License key generator (URL-safe, 24 chars, 4-blocks)
CREATE OR REPLACE FUNCTION public.generate_license_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  _out text := '';
  _i int;
BEGIN
  FOR _i IN 1..24 LOOP
    _out := _out || substr(_alphabet, 1 + floor(random() * length(_alphabet))::int, 1);
    IF _i IN (6, 12, 18) THEN _out := _out || '-'; END IF;
  END LOOP;
  RETURN _out;
END $$;

-- Backfill license keys
UPDATE public.subscriptions SET license_key = public.generate_license_key() WHERE license_key IS NULL;

-- Log a subscription event
CREATE OR REPLACE FUNCTION public.log_subscription_event(
  _tenant_id uuid,
  _event_type text,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _subscription_id uuid DEFAULT NULL,
  _from_plan_id uuid DEFAULT NULL,
  _to_plan_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.subscription_events
    (tenant_id, subscription_id, event_type, from_plan_id, to_plan_id, metadata, actor_user_id)
  VALUES (_tenant_id, _subscription_id, _event_type, _from_plan_id, _to_plan_id, COALESCE(_metadata,'{}'::jsonb), auth.uid())
  RETURNING id INTO _id;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES ('subscription_' || _event_type, 'subscription', _subscription_id, _tenant_id, COALESCE(_metadata,'{}'::jsonb), auth.uid());
  RETURN _id;
END $$;

-- Compute subscription state
CREATE OR REPLACE FUNCTION public.subscription_state(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t public.tenants;
  _s record;
  _now timestamptz := now();
  _state text;
  _grace_ends timestamptz;
  _days_left int;
  _grace_left int;
BEGIN
  SELECT * INTO _t FROM public.tenants WHERE id = _tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','none'); END IF;
  IF _t.status = 'suspended' THEN
    RETURN jsonb_build_object('state','suspended','read_only', true);
  END IF;

  SELECT s.*, p.name as plan_name, p.tier, p.max_users, p.max_farms, p.max_shops, p.max_trucks,
         p.max_storage_mb, p.backup_frequency, p.report_access, p.audit_access, p.api_access, p.support_priority
    INTO _s
    FROM public.subscriptions s
    LEFT JOIN public.subscription_plans p ON p.id = s.plan_id
   WHERE s.tenant_id = _tenant_id
   ORDER BY s.expires_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','none','read_only', true);
  END IF;

  _grace_ends := _s.expires_at + make_interval(days => COALESCE(_s.grace_period_days,0));
  _days_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_s.expires_at - _now))/86400)::int);
  _grace_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_grace_ends - _now))/86400)::int);

  IF _s.cancelled_at IS NOT NULL THEN _state := 'cancelled';
  ELSIF _s.status = 'suspended' THEN _state := 'suspended';
  ELSIF _s.expires_at > _now AND _s.is_trial THEN _state := 'trial';
  ELSIF _s.expires_at > _now THEN _state := 'active';
  ELSIF _grace_ends > _now THEN _state := 'grace';
  ELSE _state := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'state', _state,
    'read_only', _state IN ('grace','expired','suspended','cancelled'),
    'subscription_id', _s.id,
    'plan_id', _s.plan_id,
    'plan_name', _s.plan_name,
    'tier', _s.tier,
    'license_key', _s.license_key,
    'issue_date', _s.issue_date,
    'activated_at', _s.activated_at,
    'expires_at', _s.expires_at,
    'cancelled_at', _s.cancelled_at,
    'grace_period_days', _s.grace_period_days,
    'grace_ends_at', _grace_ends,
    'days_left', _days_left,
    'grace_days_left', _grace_left,
    'is_trial', _s.is_trial,
    'trial_days', _s.trial_days,
    'quotas', jsonb_build_object(
      'max_users', _s.max_users,
      'max_farms', _s.max_farms,
      'max_shops', _s.max_shops,
      'max_trucks', _s.max_trucks,
      'max_storage_mb', _s.max_storage_mb,
      'backup_frequency', _s.backup_frequency,
      'report_access', _s.report_access,
      'audit_access', _s.audit_access,
      'api_access', _s.api_access,
      'support_priority', _s.support_priority
    )
  );
END $$;

-- Usage snapshot
CREATE OR REPLACE FUNCTION public.tenant_usage(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _users int;
  _farms int;
  _shops int;
  _trucks int;
  _backups int;
  _backup_bytes bigint;
  _reports_30d int;
  _logins_30d int;
BEGIN
  SELECT count(*) INTO _users FROM public.tenant_users WHERE tenant_id = _tenant_id AND status = 'active';
  SELECT count(*) INTO _farms FROM public.farms WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _shops FROM public.shops WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _trucks FROM public.trucks WHERE tenant_id = _tenant_id;
  SELECT count(*), COALESCE(SUM(file_size),0) INTO _backups, _backup_bytes FROM public.backup_history WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _reports_30d FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND action LIKE 'report_%' AND created_at > now() - interval '30 days';
  SELECT count(*) INTO _logins_30d FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND action = 'auth_login' AND created_at > now() - interval '30 days';

  RETURN jsonb_build_object(
    'users', _users,
    'farms', _farms,
    'shops', _shops,
    'trucks', _trucks,
    'backups', _backups,
    'backup_storage_mb', ROUND(_backup_bytes::numeric / (1024*1024), 2),
    'reports_last_30d', _reports_30d,
    'logins_last_30d', _logins_30d
  );
END $$;

-- Notify approaching expiries (safe to invoke by scheduler or manually)
CREATE OR REPLACE FUNCTION public.notify_expiring_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rec record;
  _days int;
  _win int;
  _n int := 0;
  _title text;
  _msg text;
  _dedupe text;
BEGIN
  FOR _rec IN
    SELECT s.id, s.tenant_id, s.expires_at, t.company_name
      FROM public.subscriptions s
      JOIN public.tenants t ON t.id = s.tenant_id
     WHERE s.status IN ('active','trial')
       AND s.cancelled_at IS NULL
       AND s.expires_at BETWEEN now() - interval '2 days' AND now() + interval '31 days'
  LOOP
    _days := CEIL(EXTRACT(EPOCH FROM (_rec.expires_at - now()))/86400)::int;
    IF _days <= 0 THEN _win := 0;
    ELSIF _days <= 1 THEN _win := 1;
    ELSIF _days <= 3 THEN _win := 3;
    ELSIF _days <= 7 THEN _win := 7;
    ELSIF _days <= 15 THEN _win := 15;
    ELSIF _days <= 30 THEN _win := 30;
    ELSE CONTINUE;
    END IF;

    IF _win = 0 THEN
      _title := 'Subscription expired';
      _msg := 'Subscription for ' || _rec.company_name || ' has expired. Grace period in effect.';
    ELSE
      _title := 'Subscription expiring in ' || _win || ' day' || CASE WHEN _win=1 THEN '' ELSE 's' END;
      _msg := 'Subscription for ' || _rec.company_name || ' expires on ' || to_char(_rec.expires_at, 'YYYY-MM-DD') || '.';
    END IF;
    _dedupe := 'sub_expiry:' || _rec.id::text || ':' || _win::text;

    PERFORM public.notify_admins_of_tenant(
      _rec.tenant_id, NULL,
      CASE WHEN _win = 0 THEN 'subscription_expired' ELSE 'subscription_expiring' END::public.notification_type,
      _title, _msg,
      CASE WHEN _win <= 3 THEN 'critical'::public.notification_priority
           WHEN _win <= 7 THEN 'high'::public.notification_priority
           ELSE 'normal'::public.notification_priority END,
      'subscription', 'subscriptions', _rec.id,
      jsonb_build_object('expires_at', _rec.expires_at, 'window_days', _win),
      _dedupe
    );

    -- Log a notice_sent event only once per window
    INSERT INTO public.subscription_events (tenant_id, subscription_id, event_type, metadata)
    SELECT _rec.tenant_id, _rec.id, 'notice_sent', jsonb_build_object('window_days', _win, 'expires_at', _rec.expires_at)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.subscription_events
       WHERE subscription_id = _rec.id AND event_type = 'notice_sent'
         AND (metadata->>'window_days')::int = _win
    );

    _n := _n + 1;
  END LOOP;
  RETURN _n;
EXCEPTION WHEN OTHERS THEN
  RETURN _n;
END $$;
