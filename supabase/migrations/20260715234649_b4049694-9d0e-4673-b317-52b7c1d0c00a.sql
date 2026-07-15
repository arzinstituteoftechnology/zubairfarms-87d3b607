
-- ============ Enums ============
DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('queued','running','succeeded','failed','cancelled','dead');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ Main queue / history table ============
CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NULL,
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  status public.job_status NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  duration_ms int NULL,
  last_error text NULL,
  error_details jsonb NULL,
  progress numeric(5,2) NOT NULL DEFAULT 0,
  progress_message text NULL,
  worker_id text NULL,
  locked_at timestamptz NULL,
  retention_expires_at timestamptz NULL,
  result jsonb NULL,
  created_by uuid NULL,
  cancelled_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: for a given (tenant, type, key) only ONE active (non-terminal) row.
CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_idempotency_active_idx
  ON public.background_jobs (job_type, COALESCE(tenant_id::text,''), idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('queued','running');

CREATE INDEX IF NOT EXISTS background_jobs_status_priority_idx
  ON public.background_jobs (status, priority, next_run_at);
CREATE INDEX IF NOT EXISTS background_jobs_tenant_idx ON public.background_jobs (tenant_id);
CREATE INDEX IF NOT EXISTS background_jobs_type_idx   ON public.background_jobs (job_type);

GRANT SELECT ON public.background_jobs TO authenticated;
GRANT ALL    ON public.background_jobs TO service_role;

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_all_jobs"     ON public.background_jobs;
DROP POLICY IF EXISTS "tenant_admin_view_jobs"   ON public.background_jobs;

CREATE POLICY "super_admin_all_jobs"
  ON public.background_jobs FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "tenant_admin_view_jobs"
  ON public.background_jobs FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = public.current_tenant_id()
    AND public.is_tenant_owner(auth.uid())
  );

CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime for live progress
ALTER TABLE public.background_jobs REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='background_jobs';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs';
  END IF;
END $$;

-- ============ Dead-letter table ============
CREATE TABLE IF NOT EXISTS public.background_jobs_dead_letter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id uuid NOT NULL,
  tenant_id uuid NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts int NOT NULL,
  last_error text NULL,
  error_details jsonb NULL,
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dead_letter_tenant_idx ON public.background_jobs_dead_letter (tenant_id);
CREATE INDEX IF NOT EXISTS dead_letter_type_idx   ON public.background_jobs_dead_letter (job_type);

GRANT SELECT ON public.background_jobs_dead_letter TO authenticated;
GRANT ALL    ON public.background_jobs_dead_letter TO service_role;

ALTER TABLE public.background_jobs_dead_letter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_dlq" ON public.background_jobs_dead_letter;
CREATE POLICY "super_admin_dlq"
  ON public.background_jobs_dead_letter FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ============ Enqueue with idempotency ============
CREATE OR REPLACE FUNCTION public.enqueue_job(
  _job_type text,
  _tenant_id uuid,
  _payload jsonb,
  _priority smallint DEFAULT 3,
  _idempotency_key text DEFAULT NULL,
  _delay_seconds int DEFAULT 0,
  _max_attempts int DEFAULT 5,
  _retention_hours int DEFAULT 168
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _existing uuid;
BEGIN
  IF _job_type IS NULL OR length(trim(_job_type)) = 0 THEN
    RAISE EXCEPTION 'job_type required' USING ERRCODE='22023';
  END IF;
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.background_jobs
     WHERE job_type = _job_type
       AND COALESCE(tenant_id::text,'') = COALESCE(_tenant_id::text,'')
       AND idempotency_key = _idempotency_key
       AND status IN ('queued','running')
     LIMIT 1;
    IF FOUND THEN RETURN _existing; END IF;
  END IF;
  INSERT INTO public.background_jobs
    (tenant_id, job_type, payload, priority, idempotency_key,
     max_attempts, next_run_at, scheduled_at,
     retention_expires_at, created_by)
  VALUES
    (_tenant_id, _job_type, COALESCE(_payload,'{}'::jsonb),
     COALESCE(_priority,3), _idempotency_key,
     GREATEST(1, _max_attempts),
     now() + make_interval(secs => GREATEST(0,_delay_seconds)),
     now(),
     now() + make_interval(hours => GREATEST(1,_retention_hours)),
     auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- ============ Claim next batch (concurrency-safe) ============
-- Uses FOR UPDATE SKIP LOCKED so parallel workers never grab the same job.
CREATE OR REPLACE FUNCTION public.claim_next_jobs(_worker_id text, _limit int DEFAULT 10)
RETURNS SETOF public.background_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.background_jobs
     WHERE status = 'queued'
       AND next_run_at <= now()
     ORDER BY priority ASC, next_run_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, _limit)
  )
  UPDATE public.background_jobs j
     SET status = 'running',
         started_at = now(),
         attempts = j.attempts + 1,
         worker_id = _worker_id,
         locked_at = now(),
         progress = 0,
         progress_message = NULL
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
END $$;

-- ============ Report progress (for realtime UI) ============
CREATE OR REPLACE FUNCTION public.report_job_progress(_id uuid, _pct numeric, _message text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.background_jobs
     SET progress = LEAST(100, GREATEST(0, _pct)),
         progress_message = _message
   WHERE id = _id AND status = 'running';
$$;

-- ============ Complete ============
CREATE OR REPLACE FUNCTION public.complete_job(_id uuid, _result jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _started timestamptz;
BEGIN
  SELECT started_at INTO _started FROM public.background_jobs WHERE id = _id;
  UPDATE public.background_jobs
     SET status = 'succeeded',
         finished_at = now(),
         duration_ms = EXTRACT(EPOCH FROM (now() - COALESCE(_started, now())))*1000,
         progress = 100,
         result = _result,
         worker_id = NULL,
         locked_at = NULL
   WHERE id = _id;
END $$;

-- ============ Fail with exponential backoff / dead-letter ============
CREATE OR REPLACE FUNCTION public.fail_job(_id uuid, _error text, _details jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _j public.background_jobs; _backoff int; _started timestamptz;
BEGIN
  SELECT * INTO _j FROM public.background_jobs WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  _started := _j.started_at;

  IF _j.attempts >= _j.max_attempts THEN
    -- move to dead-letter
    INSERT INTO public.background_jobs_dead_letter
      (original_job_id, tenant_id, job_type, payload, attempts, last_error, error_details)
    VALUES (_j.id, _j.tenant_id, _j.job_type, _j.payload, _j.attempts, _error, _details);

    UPDATE public.background_jobs
       SET status='dead', finished_at = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - COALESCE(_started, now())))*1000,
           last_error = _error, error_details = _details,
           worker_id = NULL, locked_at = NULL
     WHERE id = _id;
  ELSE
    -- exponential backoff: 2^attempts seconds capped at 1h, +/- 20% jitter
    _backoff := LEAST(3600, POWER(2, _j.attempts)::int);
    _backoff := GREATEST(1, _backoff + ((_backoff * ((random()-0.5)*0.4)))::int);
    UPDATE public.background_jobs
       SET status='queued',
           next_run_at = now() + make_interval(secs => _backoff),
           last_error = _error, error_details = _details,
           worker_id = NULL, locked_at = NULL,
           progress = 0, progress_message = NULL
     WHERE id = _id;
  END IF;
END $$;

-- ============ Cancel / Retry / Delete / Run now ============
CREATE OR REPLACE FUNCTION public.cancel_job(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can cancel jobs' USING ERRCODE='42501';
  END IF;
  UPDATE public.background_jobs
     SET status='cancelled', finished_at=now(),
         cancelled_by=auth.uid(),
         worker_id=NULL, locked_at=NULL
   WHERE id=_id AND status IN ('queued','running');
END $$;

CREATE OR REPLACE FUNCTION public.retry_job(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can retry jobs' USING ERRCODE='42501';
  END IF;
  UPDATE public.background_jobs
     SET status='queued', next_run_at=now(),
         attempts = CASE WHEN status='dead' THEN 0 ELSE attempts END,
         started_at=NULL, finished_at=NULL, duration_ms=NULL,
         last_error=NULL, error_details=NULL, progress=0, progress_message=NULL,
         worker_id=NULL, locked_at=NULL
   WHERE id=_id AND status IN ('failed','dead','cancelled','succeeded');
END $$;

CREATE OR REPLACE FUNCTION public.run_job_now(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can run jobs immediately' USING ERRCODE='42501';
  END IF;
  UPDATE public.background_jobs
     SET next_run_at = now()
   WHERE id = _id AND status = 'queued';
END $$;

CREATE OR REPLACE FUNCTION public.delete_job(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can delete jobs' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.background_jobs WHERE id=_id AND status IN ('succeeded','failed','dead','cancelled');
END $$;

-- ============ Crash / stuck-job recovery ============
-- Any job stuck in 'running' beyond stale_minutes is requeued (worker crashed).
CREATE OR REPLACE FUNCTION public.recover_stuck_jobs(_stale_minutes int DEFAULT 15)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  WITH upd AS (
    UPDATE public.background_jobs
       SET status = 'queued',
           next_run_at = now(),
           last_error = COALESCE(last_error,'worker crashed / job stalled'),
           worker_id = NULL, locked_at = NULL,
           progress = 0, progress_message = NULL
     WHERE status = 'running'
       AND locked_at < now() - make_interval(mins => GREATEST(1,_stale_minutes))
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd;
  RETURN COALESCE(_n,0);
END $$;

-- ============ Cleanup by retention ============
CREATE OR REPLACE FUNCTION public.cleanup_background_jobs()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  WITH del AS (
    DELETE FROM public.background_jobs
     WHERE status IN ('succeeded','cancelled')
       AND retention_expires_at IS NOT NULL
       AND retention_expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM del;
  RETURN COALESCE(_n,0);
END $$;
