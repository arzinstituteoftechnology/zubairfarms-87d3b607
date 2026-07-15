
-- Backfill missing tenant_id / entity_id on future audit rows written by the two
-- generic audit triggers. Both currently insert with only (action, entity,
-- metadata, actor_user_id) which breaks the "tenant read own logs" RLS policy
-- and drops record-level traceability.

CREATE OR REPLACE FUNCTION public.audit_perm_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tid uuid;
  _eid uuid;
BEGIN
  -- Prefer the row's tenant_id when present, otherwise fall back to the caller's tenant.
  _tid := COALESCE(
    NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'tenant_id'
                 ELSE to_jsonb(OLD)->>'tenant_id' END), '')::uuid,
    public.current_tenant_id()
  );
  _eid := NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'id'
                       ELSE to_jsonb(OLD)->>'id' END), '')::uuid;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES (
    lower(TG_TABLE_NAME) || '_' || lower(TG_OP),
    TG_TABLE_NAME,
    _eid,
    _tid,
    jsonb_build_object('op', TG_OP,
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END),
    auth.uid()
  );
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.audit_settings_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tid uuid;
  _eid uuid;
BEGIN
  _tid := COALESCE(
    NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'tenant_id'
                 ELSE to_jsonb(OLD)->>'tenant_id' END), '')::uuid,
    public.current_tenant_id()
  );
  _eid := NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'id'
                       ELSE to_jsonb(OLD)->>'id' END), '')::uuid;

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES (
    lower(TG_TABLE_NAME) || '_' || lower(TG_OP),
    TG_TABLE_NAME,
    _eid,
    _tid,
    jsonb_build_object('op', TG_OP,
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END),
    auth.uid()
  );
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Same treatment for the unauthorized-attempt writer inside the permission guard,
-- so tenant admins can see denied-action attempts scoped to their tenant.
CREATE OR REPLACE FUNCTION public.enforce_permission_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _module text; _action text; _tid uuid; _eid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.is_super_admin() THEN RETURN COALESCE(NEW, OLD); END IF;
  _module := TG_ARGV[0];
  _action := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'edit' WHEN 'DELETE' THEN 'delete' END;
  IF NOT public.has_permission(auth.uid(), _module, _action) THEN
    _tid := COALESCE(
      NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'tenant_id'
                   ELSE to_jsonb(OLD)->>'tenant_id' END), '')::uuid,
      public.current_tenant_id()
    );
    _eid := NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'id'
                         ELSE to_jsonb(OLD)->>'id' END), '')::uuid;
    INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
    VALUES ('unauthorized_action_attempt', _module, _eid, _tid,
      jsonb_build_object('required_action', _action, 'op', TG_OP), auth.uid());
    RAISE EXCEPTION 'You do not have permission to % on %', _action, _module USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;
