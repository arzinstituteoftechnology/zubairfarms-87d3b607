
-- ============ Enums ============
DO $$ BEGIN
  CREATE TYPE public.system_error_severity AS ENUM ('info','warning','error','critical');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.health_status AS ENUM ('green','yellow','red');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ system_errors ============
CREATE TABLE IF NOT EXISTS public.system_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  user_id uuid NULL,
  module text NOT NULL DEFAULT 'unknown',
  source text NOT NULL DEFAULT 'server', -- server | client | job | edge_function
  severity public.system_error_severity NOT NULL DEFAULT 'error',
  message text NOT NULL,
  stack text NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_path text NULL,
  request_method text NULL,
  status_code int NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid NULL,
  resolved_at timestamptz NULL,
  resolution_notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_errors_created_idx ON public.system_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS system_errors_tenant_idx  ON public.system_errors (tenant_id);
CREATE INDEX IF NOT EXISTS system_errors_severity_idx ON public.system_errors (severity);
CREATE INDEX IF NOT EXISTS system_errors_resolved_idx ON public.system_errors (resolved);

GRANT SELECT ON public.system_errors TO authenticated;
GRANT ALL    ON public.system_errors TO service_role;

ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_errors_all" ON public.system_errors;
DROP POLICY IF EXISTS "tenant_owner_errors_view" ON public.system_errors;
DROP POLICY IF EXISTS "super_admin_errors_update" ON public.system_errors;

CREATE POLICY "super_admin_errors_all"
  ON public.system_errors FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "tenant_owner_errors_view"
  ON public.system_errors FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = public.current_tenant_id()
    AND public.is_tenant_owner(auth.uid())
  );

CREATE POLICY "super_admin_errors_update"
  ON public.system_errors FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

ALTER TABLE public.system_errors REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='system_errors') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.system_errors';
  END IF;
END $$;

-- ============ system_health_snapshots ============
CREATE TABLE IF NOT EXISTS public.system_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overall public.health_status NOT NULL,
  components jsonb NOT NULL DEFAULT '{}'::jsonb, -- { database:'green', auth:'green', ...}
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,    -- raw numbers
  latency_ms int NULL,
  worker_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_snapshots_created_idx ON public.system_health_snapshots (created_at DESC);

GRANT SELECT ON public.system_health_snapshots TO authenticated;
GRANT ALL    ON public.system_health_snapshots TO service_role;

ALTER TABLE public.system_health_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_health_snapshots" ON public.system_health_snapshots;
CREATE POLICY "super_admin_health_snapshots"
  ON public.system_health_snapshots FOR SELECT TO authenticated
  USING (public.is_super_admin());

ALTER TABLE public.system_health_snapshots REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='system_health_snapshots') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.system_health_snapshots';
  END IF;
END $$;

-- ============ alert_rules + alert_incidents ============
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  metric text NOT NULL,              -- e.g. 'failed_jobs_15m', 'queue_size', 'errors_15m', 'scheduler_last_tick_seconds', 'db_healthy'
  op text NOT NULL,                  -- '>', '>=', '<', '<=', '='
  threshold numeric NOT NULL,
  severity public.system_error_severity NOT NULL DEFAULT 'warning',
  enabled boolean NOT NULL DEFAULT true,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.alert_rules TO authenticated;
GRANT ALL    ON public.alert_rules TO service_role;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_alert_rules" ON public.alert_rules;
CREATE POLICY "super_admin_alert_rules"
  ON public.alert_rules FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON public.alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.alert_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.alert_rules(id) ON DELETE CASCADE,
  metric text NOT NULL,
  observed_value numeric NOT NULL,
  threshold numeric NOT NULL,
  severity public.system_error_severity NOT NULL,
  status text NOT NULL DEFAULT 'firing',  -- firing | resolved
  fired_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  snapshot_id uuid NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS alert_incidents_status_idx ON public.alert_incidents (status);
CREATE INDEX IF NOT EXISTS alert_incidents_fired_idx  ON public.alert_incidents (fired_at DESC);

GRANT SELECT ON public.alert_incidents TO authenticated;
GRANT ALL    ON public.alert_incidents TO service_role;
ALTER TABLE public.alert_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_alert_incidents" ON public.alert_incidents;
CREATE POLICY "super_admin_alert_incidents"
  ON public.alert_incidents FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

ALTER TABLE public.alert_incidents REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='alert_incidents') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_incidents';
  END IF;
END $$;

-- ============ RPCs ============
CREATE OR REPLACE FUNCTION public.log_system_error(
  _module text, _message text, _severity public.system_error_severity DEFAULT 'error',
  _stack text DEFAULT NULL, _context jsonb DEFAULT '{}'::jsonb,
  _source text DEFAULT 'server', _status_code int DEFAULT NULL,
  _request_path text DEFAULT NULL, _request_method text DEFAULT NULL,
  _tenant_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _tid uuid;
BEGIN
  _tid := COALESCE(_tenant_id, public.current_tenant_id());
  INSERT INTO public.system_errors
    (tenant_id, user_id, module, source, severity, message, stack, context,
     status_code, request_path, request_method)
  VALUES (_tid, auth.uid(), _module, _source, _severity, _message, _stack, COALESCE(_context,'{}'::jsonb),
          _status_code, _request_path, _request_method)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_system_error(text,text,public.system_error_severity,text,jsonb,text,int,text,text,uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.resolve_system_error(_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can resolve system errors' USING ERRCODE='42501';
  END IF;
  UPDATE public.system_errors
     SET resolved = true, resolved_by = auth.uid(), resolved_at = now(),
         resolution_notes = _notes
   WHERE id = _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_system_error(uuid,text) FROM anon;

-- Compact snapshot used by the dashboard's Live Metrics panel
CREATE OR REPLACE FUNCTION public.get_live_metrics(_window_minutes int DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _res jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can read live metrics' USING ERRCODE='42501';
  END IF;
  WITH
    q AS (SELECT count(*) c FROM public.background_jobs WHERE status='queued'),
    r AS (SELECT count(*) c FROM public.background_jobs WHERE status='running'),
    f AS (SELECT count(*) c FROM public.background_jobs
           WHERE status IN ('failed','dead')
             AND updated_at > now() - make_interval(mins => _window_minutes)),
    d AS (SELECT count(*) c FROM public.background_jobs_dead_letter),
    e AS (SELECT count(*) c FROM public.system_errors
           WHERE created_at > now() - make_interval(mins => _window_minutes)),
    ecrit AS (SELECT count(*) c FROM public.system_errors
           WHERE severity IN ('error','critical') AND resolved = false),
    li AS (SELECT count(*) c FROM public.super_admin_login_attempts
           WHERE created_at > now() - make_interval(mins => _window_minutes)),
    ai AS (SELECT count(*) c FROM public.alert_incidents WHERE status='firing'),
    sched AS (SELECT max(created_at) m FROM public.activity_logs WHERE action='job_scheduler_tick'),
    reqs AS (SELECT count(*) c FROM public.activity_logs
             WHERE created_at > now() - make_interval(mins => 1)),
    users_active AS (SELECT count(DISTINCT actor_user_id) c FROM public.activity_logs
             WHERE actor_user_id IS NOT NULL
               AND created_at > now() - make_interval(mins => _window_minutes)),
    dur AS (
      SELECT AVG(duration_ms)::int avg_ms, MAX(duration_ms) max_ms
      FROM public.background_jobs
      WHERE finished_at > now() - make_interval(mins => _window_minutes)
        AND duration_ms IS NOT NULL
    )
  SELECT jsonb_build_object(
    'queue_size',            (SELECT c FROM q),
    'running_jobs',          (SELECT c FROM r),
    'failed_jobs_window',    (SELECT c FROM f),
    'dead_letter_total',     (SELECT c FROM d),
    'errors_window',         (SELECT c FROM e),
    'unresolved_errors',     (SELECT c FROM ecrit),
    'login_attempts_window', (SELECT c FROM li),
    'firing_alerts',         (SELECT c FROM ai),
    'scheduler_last_tick',   (SELECT m FROM sched),
    'scheduler_last_tick_seconds', EXTRACT(EPOCH FROM (now() - (SELECT m FROM sched)))::int,
    'requests_last_minute',  (SELECT c FROM reqs),
    'active_users_window',   (SELECT c FROM users_active),
    'avg_job_duration_ms',   (SELECT avg_ms FROM dur),
    'max_job_duration_ms',   (SELECT max_ms FROM dur),
    'window_minutes',        _window_minutes,
    'generated_at',          now()
  ) INTO _res;
  RETURN _res;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_live_metrics(int) FROM anon;

-- Seed default alert rules if empty
INSERT INTO public.alert_rules (name, metric, op, threshold, severity, description)
SELECT * FROM (VALUES
  ('High Error Rate',        'errors_window',              '>',  5,   'error'::public.system_error_severity, 'More than 5 errors in the last 15 minutes'),
  ('Queue Overflow',         'queue_size',                 '>',  100, 'warning'::public.system_error_severity, 'Background job queue is backing up'),
  ('Worker Offline',         'scheduler_last_tick_seconds','>',  300, 'critical'::public.system_error_severity, 'Scheduler has not ticked in 5 minutes'),
  ('Failed Jobs Spike',      'failed_jobs_window',         '>',  10,  'error'::public.system_error_severity, 'More than 10 failed jobs in the last 15 minutes'),
  ('Dead-letter Growth',     'dead_letter_total',          '>',  50,  'warning'::public.system_error_severity, 'Dead-letter queue exceeds 50 items')
) v(name, metric, op, threshold, severity, description)
WHERE NOT EXISTS (SELECT 1 FROM public.alert_rules);
