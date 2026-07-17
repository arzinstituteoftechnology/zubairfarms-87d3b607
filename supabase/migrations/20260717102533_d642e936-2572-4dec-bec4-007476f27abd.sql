
-- Maintenance mode (per tenant)
CREATE TABLE IF NOT EXISTS public.maintenance_mode (
  tenant_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  message text,
  read_only boolean NOT NULL DEFAULT true,
  estimated_return_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_mode TO authenticated;
GRANT ALL ON public.maintenance_mode TO service_role;
ALTER TABLE public.maintenance_mode ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner or sa read maintenance" ON public.maintenance_mode;
CREATE POLICY "owner or sa read maintenance" ON public.maintenance_mode
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id()));

DROP POLICY IF EXISTS "owner or sa manage maintenance" ON public.maintenance_mode;
CREATE POLICY "owner or sa manage maintenance" ON public.maintenance_mode
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())))
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())));

-- Tenant-scoped health snapshot
CREATE OR REPLACE FUNCTION public.tenant_health_snapshot(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _jobs_queued int; _jobs_running int; _jobs_failed int; _jobs_success int;
  _errors_24h int; _errors_unresolved int;
  _users_active int; _sessions_15m int;
  _backup_last timestamptz; _backup_status text; _backup_bytes bigint;
  _email_pending int;
  _sched_last timestamptz;
  _requests_1m int; _requests_1h int;
BEGIN
  IF NOT (public.is_super_admin() OR (public.is_tenant_owner(auth.uid()) AND _tenant_id = public.current_tenant_id())) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE='42501';
  END IF;

  SELECT count(*) FILTER (WHERE status='queued'),
         count(*) FILTER (WHERE status='running'),
         count(*) FILTER (WHERE status IN ('failed','dead') AND updated_at > _now - interval '24 hours'),
         count(*) FILTER (WHERE status='succeeded' AND updated_at > _now - interval '24 hours')
    INTO _jobs_queued, _jobs_running, _jobs_failed, _jobs_success
    FROM public.background_jobs
    WHERE tenant_id = _tenant_id OR tenant_id IS NULL;

  SELECT count(*), count(*) FILTER (WHERE resolved = false)
    INTO _errors_24h, _errors_unresolved
    FROM public.system_errors
    WHERE (tenant_id = _tenant_id OR tenant_id IS NULL)
      AND created_at > _now - interval '24 hours';

  SELECT count(*) INTO _users_active FROM public.tenant_users WHERE tenant_id = _tenant_id AND status='active';

  SELECT count(DISTINCT actor_user_id) INTO _sessions_15m
    FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND actor_user_id IS NOT NULL
      AND created_at > _now - interval '15 minutes';

  SELECT max(created_at), COALESCE(SUM(file_size),0)
    INTO _backup_last, _backup_bytes
    FROM public.backup_history WHERE tenant_id = _tenant_id;
  SELECT status INTO _backup_status FROM public.backup_history
    WHERE tenant_id = _tenant_id ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO _email_pending
    FROM public.email_notification_queue
    WHERE tenant_id = _tenant_id AND sent_at IS NULL;

  SELECT max(created_at) INTO _sched_last FROM public.activity_logs
    WHERE action = 'job_scheduler_tick';

  SELECT count(*) INTO _requests_1m FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND created_at > _now - interval '1 minute';
  SELECT count(*) INTO _requests_1h FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND created_at > _now - interval '1 hour';

  RETURN jsonb_build_object(
    'generated_at', _now,
    'jobs', jsonb_build_object('queued',_jobs_queued,'running',_jobs_running,'failed_24h',_jobs_failed,'succeeded_24h',_jobs_success),
    'errors', jsonb_build_object('last_24h',_errors_24h,'unresolved',_errors_unresolved),
    'users', jsonb_build_object('active',_users_active,'sessions_15m',_sessions_15m),
    'backup', jsonb_build_object('last_at',_backup_last,'status',_backup_status,'total_bytes',_backup_bytes),
    'email_queue_pending', _email_pending,
    'scheduler_last_tick', _sched_last,
    'scheduler_last_tick_seconds', EXTRACT(EPOCH FROM (_now - _sched_last))::int,
    'requests_last_minute', _requests_1m,
    'requests_last_hour', _requests_1h
  );
END $$;

-- Frontend error logging RPC
CREATE OR REPLACE FUNCTION public.log_frontend_error(
  _module text,
  _message text,
  _severity text DEFAULT 'error',
  _stack text DEFAULT NULL,
  _context jsonb DEFAULT '{}'::jsonb,
  _request_path text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid; _tid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF _message IS NULL OR length(trim(_message))=0 THEN RAISE EXCEPTION 'message required' USING ERRCODE='22023'; END IF;
  SELECT tenant_id INTO _tid FROM public.tenant_users WHERE user_id = auth.uid() LIMIT 1;
  INSERT INTO public.system_errors (tenant_id, user_id, module, source, severity, message, stack, context, request_path)
  VALUES (_tid, auth.uid(), COALESCE(_module,'frontend'), 'frontend',
          COALESCE(_severity,'error')::public.system_error_severity,
          _message, _stack, COALESCE(_context,'{}'::jsonb), _request_path)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
