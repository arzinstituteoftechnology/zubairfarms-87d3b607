
-- Attach existing audit_financial_change trigger to remaining domain tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['farms','shops','customers','deliveries','trucks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_audit_activity_' || t
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_financial_change()',
        'trg_audit_activity_' || t, t
      );
    END IF;
  END LOOP;
END $$;

-- Auth event logger: SECURITY DEFINER so anonymous callers (failed login) can insert.
CREATE OR REPLACE FUNCTION public.log_auth_event(
  _event text,
  _success boolean DEFAULT true,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _headers jsonb;
  _ip text;
  _ua text;
  _tid uuid;
  _id uuid;
  _meta jsonb;
BEGIN
  IF _event IS NULL OR length(trim(_event)) = 0 THEN
    RAISE EXCEPTION 'event required' USING ERRCODE = '22023';
  END IF;
  BEGIN _headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN _headers := NULL; END;
  _ip := COALESCE(_headers->>'x-forwarded-for', _headers->>'cf-connecting-ip');
  _ua := _headers->>'user-agent';
  IF auth.uid() IS NOT NULL THEN
    SELECT tenant_id INTO _tid FROM public.tenant_users WHERE user_id = auth.uid() LIMIT 1;
  END IF;
  _meta := COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object(
    'success', _success,
    'ip', _ip,
    'user_agent', _ua
  );
  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES ('auth_' || _event, 'auth', NULL, _tid, _meta, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

GRANT EXECUTE ON FUNCTION public.log_auth_event(text, boolean, jsonb) TO anon, authenticated;

-- Indexes for Activity Center filters.
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_created
  ON public.activity_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_created
  ON public.activity_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_action_created
  ON public.activity_logs (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_created
  ON public.activity_logs (entity, created_at DESC);
