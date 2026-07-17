
-- ============================================================================
-- ENTERPRISE RBAC PHASE 1 — SCHEMA
-- ============================================================================

CREATE TABLE public.permission_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  actor_ip text,
  actor_user_agent text,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email text,
  action text NOT NULL CHECK (action IN (
    'role_changed','status_changed','override_set','override_cleared',
    'role_template_created','role_template_updated','role_template_deleted','role_template_restored',
    'bulk_role_applied','bulk_permissions_copied','bulk_permissions_reset',
    'invite_sent','invite_resent','invite_revoked','invite_accepted'
  )),
  module text,
  permission_action text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_perm_audit_tenant_time ON public.permission_audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_perm_audit_actor ON public.permission_audit_log(actor_user_id);
CREATE INDEX idx_perm_audit_target ON public.permission_audit_log(target_user_id);
CREATE INDEX idx_perm_audit_action ON public.permission_audit_log(action);

GRANT SELECT ON public.permission_audit_log TO authenticated;
GRANT ALL ON public.permission_audit_log TO service_role;
ALTER TABLE public.permission_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner/SA read permission audit"
  ON public.permission_audit_log FOR SELECT
  TO authenticated
  USING (public.is_super_admin()
     OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())));

CREATE OR REPLACE FUNCTION public._perm_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'permission_audit_log is append-only' USING ERRCODE='42501'; END; $$;

CREATE TRIGGER perm_audit_no_update
  BEFORE UPDATE OR DELETE ON public.permission_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._perm_audit_append_only();

CREATE OR REPLACE FUNCTION public._req_meta()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _h jsonb;
BEGIN
  BEGIN _h := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN _h := '{}'::jsonb; END;
  RETURN jsonb_build_object(
    'ip',        COALESCE(_h->>'x-forwarded-for', _h->>'cf-connecting-ip'),
    'user_agent', _h->>'user-agent'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.audit_permission_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tid uuid; _actor uuid; _actor_email text; _meta jsonb;
  _target uuid; _target_email text;
  _action text; _module text; _perm_action text;
  _prev jsonb; _new jsonb;
BEGIN
  _actor := auth.uid();
  _meta := public._req_meta();
  IF _actor IS NOT NULL THEN
    SELECT email INTO _actor_email FROM auth.users WHERE id = _actor;
  END IF;

  _tid := COALESCE(
    NULLIF((CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'tenant_id'
                 ELSE to_jsonb(OLD)->>'tenant_id' END), '')::uuid,
    public.current_tenant_id()
  );

  IF TG_TABLE_NAME = 'tenant_users' THEN
    _target := COALESCE(NEW.user_id, OLD.user_id);
    SELECT email INTO _target_email FROM auth.users WHERE id = _target;
    IF TG_OP = 'UPDATE' AND NEW.tenant_role IS DISTINCT FROM OLD.tenant_role THEN
      _action := 'role_changed';
      _prev := jsonb_build_object('tenant_role', OLD.tenant_role);
      _new  := jsonb_build_object('tenant_role', NEW.tenant_role);
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      _action := 'status_changed';
      _prev := jsonb_build_object('status', OLD.status);
      _new  := jsonb_build_object('status', NEW.status);
    ELSE
      RETURN COALESCE(NEW, OLD);
    END IF;
  ELSIF TG_TABLE_NAME = 'user_permission_overrides' THEN
    _target := COALESCE(NEW.user_id, OLD.user_id);
    SELECT email INTO _target_email FROM auth.users WHERE id = _target;
    _module := COALESCE(NEW.module, OLD.module);
    _perm_action := COALESCE(NEW.action, OLD.action);
    IF TG_OP = 'DELETE' THEN
      _action := 'override_cleared';
      _prev := jsonb_build_object('allowed', OLD.allowed);
    ELSE
      _action := 'override_set';
      _prev := CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('allowed', OLD.allowed) END;
      _new  := jsonb_build_object('allowed', NEW.allowed);
    END IF;
  ELSIF TG_TABLE_NAME = 'role_templates' THEN
    IF TG_OP = 'INSERT' THEN _action := 'role_template_created'; _new := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN _action := 'role_template_updated'; _prev := to_jsonb(OLD); _new := to_jsonb(NEW);
    ELSE _action := 'role_template_deleted'; _prev := to_jsonb(OLD);
    END IF;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.permission_audit_log
    (tenant_id, actor_user_id, actor_email, actor_ip, actor_user_agent,
     target_user_id, target_email, action, module, permission_action,
     previous_value, new_value, metadata)
  VALUES (_tid, _actor, _actor_email, _meta->>'ip', _meta->>'user_agent',
     _target, _target_email, _action, _module, _perm_action,
     _prev, _new, jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP));

  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER perm_audit_tenant_users
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.audit_permission_event();

CREATE TRIGGER perm_audit_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_permission_event();

-- Role templates ------------------------------------------------------------
CREATE TABLE public.role_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_builtin boolean NOT NULL DEFAULT false,
  builtin_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_templates_tenant_name_uk UNIQUE (tenant_id, name),
  CONSTRAINT role_templates_builtin_uk UNIQUE (builtin_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_templates TO authenticated;
GRANT ALL ON public.role_templates TO service_role;
ALTER TABLE public.role_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read role templates" ON public.role_templates FOR SELECT TO authenticated
  USING (public.is_super_admin() OR is_builtin OR tenant_id = public.current_tenant_id());
CREATE POLICY "Owner writes custom role templates" ON public.role_templates FOR INSERT TO authenticated
  WITH CHECK ((public.is_tenant_owner(auth.uid()) OR public.is_super_admin())
              AND NOT is_builtin AND tenant_id = public.current_tenant_id());
CREATE POLICY "Owner updates custom role templates" ON public.role_templates FOR UPDATE TO authenticated
  USING ((public.is_tenant_owner(auth.uid()) OR public.is_super_admin())
         AND NOT is_builtin AND tenant_id = public.current_tenant_id())
  WITH CHECK ((public.is_tenant_owner(auth.uid()) OR public.is_super_admin())
              AND NOT is_builtin AND tenant_id = public.current_tenant_id());
CREATE POLICY "Owner deletes custom role templates" ON public.role_templates FOR DELETE TO authenticated
  USING ((public.is_tenant_owner(auth.uid()) OR public.is_super_admin())
         AND NOT is_builtin AND tenant_id = public.current_tenant_id());

CREATE TRIGGER role_templates_touch BEFORE UPDATE ON public.role_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER role_templates_audit AFTER INSERT OR UPDATE OR DELETE ON public.role_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_permission_event();

CREATE TABLE public.role_template_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES public.role_templates(id) ON DELETE CASCADE,
  module text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rtp_uk UNIQUE (template_id, module, action)
);
CREATE INDEX idx_rtp_template ON public.role_template_permissions(template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_template_permissions TO authenticated;
GRANT ALL ON public.role_template_permissions TO service_role;
ALTER TABLE public.role_template_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read template perms" ON public.role_template_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.role_templates t WHERE t.id = template_id
       AND (public.is_super_admin() OR t.is_builtin OR t.tenant_id = public.current_tenant_id())));
CREATE POLICY "Owner writes template perms" ON public.role_template_permissions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.role_templates t WHERE t.id = template_id
       AND NOT t.is_builtin
       AND (public.is_super_admin() OR (public.is_tenant_owner(auth.uid()) AND t.tenant_id = public.current_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.role_templates t WHERE t.id = template_id
       AND NOT t.is_builtin
       AND (public.is_super_admin() OR (public.is_tenant_owner(auth.uid()) AND t.tenant_id = public.current_tenant_id()))));

CREATE TABLE public.role_template_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES public.role_templates(id) ON DELETE CASCADE,
  version_no int NOT NULL,
  snapshot jsonb NOT NULL,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rtv_uk UNIQUE (template_id, version_no)
);
CREATE INDEX idx_rtv_template ON public.role_template_versions(template_id, version_no DESC);

GRANT SELECT ON public.role_template_versions TO authenticated;
GRANT ALL ON public.role_template_versions TO service_role;
ALTER TABLE public.role_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read template versions" ON public.role_template_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.role_templates t WHERE t.id = template_id
     AND (public.is_super_admin() OR t.is_builtin OR t.tenant_id = public.current_tenant_id())));

CREATE OR REPLACE FUNCTION public._rtv_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'role_template_versions is append-only' USING ERRCODE='42501'; END; $$;
CREATE TRIGGER rtv_no_update BEFORE UPDATE OR DELETE ON public.role_template_versions
  FOR EACH ROW EXECUTE FUNCTION public._rtv_append_only();

CREATE OR REPLACE FUNCTION public.guard_role_template_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF OLD.is_builtin THEN RAISE EXCEPTION 'Built-in role templates cannot be deleted' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO _n FROM public.tenant_users WHERE role_template_id = OLD.id;
  IF _n > 0 THEN RAISE EXCEPTION 'Cannot delete role template with % assigned user(s)', _n USING ERRCODE='23503'; END IF;
  RETURN OLD;
END; $$;

INSERT INTO public.role_templates (name, description, is_builtin, builtin_key) VALUES
  ('Owner','Full access to every tenant module', true, 'owner'),
  ('Manager','Business ops, cannot factory reset or manage subscription', true, 'manager'),
  ('Cashier','POS, Daily Recovery, Shop Ledger', true, 'cashier'),
  ('Data Entry Operator','Add records only', true, 'data_entry'),
  ('Read Only User','View-only Dashboard, Reports, Ledgers, Inventory', true, 'read_only');

INSERT INTO public.role_template_permissions (template_id, module, action, allowed)
SELECT t.id, rp.module, rp.action, rp.allowed
FROM public.role_permissions rp
JOIN public.role_templates t ON t.builtin_key = rp.role
ON CONFLICT DO NOTHING;

ALTER TABLE public.tenant_users
  ADD COLUMN role_template_id uuid REFERENCES public.role_templates(id) ON DELETE SET NULL;
CREATE INDEX idx_tenant_users_template ON public.tenant_users(role_template_id);

-- Backfill: disable triggers that would fire during system-level UPDATE
ALTER TABLE public.tenant_users DISABLE TRIGGER notif_tenant_users;
ALTER TABLE public.tenant_users DISABLE TRIGGER audit_tenant_users;
ALTER TABLE public.tenant_users DISABLE TRIGGER perm_audit_tenant_users;
UPDATE public.tenant_users tu
   SET role_template_id = t.id
  FROM public.role_templates t
 WHERE t.builtin_key = tu.tenant_role AND tu.role_template_id IS NULL;
ALTER TABLE public.tenant_users ENABLE TRIGGER notif_tenant_users;
ALTER TABLE public.tenant_users ENABLE TRIGGER audit_tenant_users;
ALTER TABLE public.tenant_users ENABLE TRIGGER perm_audit_tenant_users;

CREATE TRIGGER role_templates_guard_delete BEFORE DELETE ON public.role_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_template_delete();

CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid, _module text, _action text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _tu public.tenant_users; _override boolean; _role_allowed boolean;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF public.is_super_admin() THEN RETURN true; END IF;
  SELECT * INTO _tu FROM public.tenant_users WHERE user_id = _uid LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _tu.status <> 'active' THEN RETURN false; END IF;
  IF _tu.tenant_role = 'owner' THEN RETURN true; END IF;
  SELECT allowed INTO _override FROM public.user_permission_overrides
    WHERE user_id = _uid AND module = _module AND action = _action;
  IF FOUND THEN RETURN _override; END IF;
  IF _tu.role_template_id IS NOT NULL THEN
    SELECT allowed INTO _role_allowed FROM public.role_template_permissions
      WHERE template_id = _tu.role_template_id AND module = _module AND action = _action;
    IF FOUND THEN RETURN COALESCE(_role_allowed, false); END IF;
  END IF;
  SELECT allowed INTO _role_allowed FROM public.role_permissions
    WHERE role = _tu.tenant_role AND module = _module AND action = _action;
  RETURN COALESCE(_role_allowed, false);
END; $$;

-- Invitations ---------------------------------------------------------------
CREATE TABLE public.user_invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  tenant_role text NOT NULL CHECK (tenant_role IN ('owner','manager','cashier','data_entry','read_only')),
  role_template_id uuid REFERENCES public.role_templates(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  sent_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  resend_count int NOT NULL DEFAULT 0,
  force_password_change boolean NOT NULL DEFAULT true,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_invitations_pending_email
  ON public.user_invitations(tenant_id, lower(email)) WHERE status = 'pending';
CREATE INDEX idx_invitations_tenant_status ON public.user_invitations(tenant_id, status);
CREATE INDEX idx_invitations_token ON public.user_invitations(token_hash);

GRANT SELECT, INSERT, UPDATE ON public.user_invitations TO authenticated;
GRANT ALL ON public.user_invitations TO service_role;
ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads invitations" ON public.user_invitations FOR SELECT TO authenticated
  USING (public.is_super_admin()
     OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())));
CREATE POLICY "Owner writes invitations" ON public.user_invitations FOR ALL TO authenticated
  USING (public.is_super_admin()
     OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())))
  WITH CHECK (public.is_super_admin()
     OR (tenant_id = public.current_tenant_id() AND public.is_tenant_owner(auth.uid())));

CREATE TRIGGER invitations_touch BEFORE UPDATE ON public.user_invitations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- profiles.must_change_password --------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Bulk permission action RPC ------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_bulk_permission_action(
  _action text, _target_user_ids uuid[],
  _new_role text DEFAULT NULL, _source_user_id uuid DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tid uuid; _uid uuid; _actor uuid := auth.uid(); _actor_email text;
  _meta jsonb := public._req_meta(); _t_email text; _prev_role text;
  _succ int := 0; _fail int := 0; _errors jsonb := '[]'::jsonb;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_super_admin() OR public.is_tenant_owner(_actor)) THEN
    RAISE EXCEPTION 'Only Owner can perform bulk permission actions' USING ERRCODE='42501';
  END IF;
  IF _action NOT IN ('assign_role','copy_permissions','reset_defaults') THEN
    RAISE EXCEPTION 'Unknown bulk action %', _action USING ERRCODE='22023';
  END IF;
  IF _target_user_ids IS NULL OR array_length(_target_user_ids,1) IS NULL THEN
    RAISE EXCEPTION 'No target users provided' USING ERRCODE='22023';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required for bulk actions' USING ERRCODE='22023';
  END IF;
  _tid := public.current_tenant_id();
  SELECT email INTO _actor_email FROM auth.users WHERE id = _actor;
  FOREACH _uid IN ARRAY _target_user_ids LOOP
    BEGIN
      SELECT email INTO _t_email FROM auth.users WHERE id = _uid;
      SELECT tenant_role INTO _prev_role FROM public.tenant_users WHERE user_id = _uid;
      IF _action = 'assign_role' THEN
        IF _new_role IS NULL THEN RAISE EXCEPTION 'new_role required'; END IF;
        UPDATE public.tenant_users SET tenant_role = _new_role,
          role_template_id = (SELECT id FROM public.role_templates WHERE builtin_key = _new_role LIMIT 1)
          WHERE user_id = _uid AND tenant_id = _tid;
        INSERT INTO public.permission_audit_log
          (tenant_id, actor_user_id, actor_email, actor_ip, actor_user_agent,
           target_user_id, target_email, action, previous_value, new_value, reason)
        VALUES (_tid, _actor, _actor_email, _meta->>'ip', _meta->>'user_agent',
           _uid, _t_email, 'bulk_role_applied',
           jsonb_build_object('tenant_role', _prev_role),
           jsonb_build_object('tenant_role', _new_role), _reason);
      ELSIF _action = 'copy_permissions' THEN
        IF _source_user_id IS NULL THEN RAISE EXCEPTION 'source_user_id required'; END IF;
        DELETE FROM public.user_permission_overrides WHERE user_id = _uid;
        INSERT INTO public.user_permission_overrides (user_id, tenant_id, module, action, allowed)
          SELECT _uid, _tid, module, action, allowed
            FROM public.user_permission_overrides WHERE user_id = _source_user_id;
        UPDATE public.tenant_users SET tenant_role = COALESCE(
          (SELECT tenant_role FROM public.tenant_users WHERE user_id = _source_user_id), tenant_role)
          WHERE user_id = _uid AND tenant_id = _tid;
        INSERT INTO public.permission_audit_log
          (tenant_id, actor_user_id, actor_email, actor_ip, actor_user_agent,
           target_user_id, target_email, action, metadata, reason)
        VALUES (_tid, _actor, _actor_email, _meta->>'ip', _meta->>'user_agent',
           _uid, _t_email, 'bulk_permissions_copied',
           jsonb_build_object('source_user_id', _source_user_id), _reason);
      ELSE
        DELETE FROM public.user_permission_overrides WHERE user_id = _uid;
        INSERT INTO public.permission_audit_log
          (tenant_id, actor_user_id, actor_email, actor_ip, actor_user_agent,
           target_user_id, target_email, action, reason)
        VALUES (_tid, _actor, _actor_email, _meta->>'ip', _meta->>'user_agent',
           _uid, _t_email, 'bulk_permissions_reset', _reason);
      END IF;
      _succ := _succ + 1;
    EXCEPTION WHEN OTHERS THEN
      _fail := _fail + 1;
      _errors := _errors || jsonb_build_object('user_id', _uid, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('success', _succ, 'failed', _fail, 'errors', _errors);
END; $$;

REVOKE ALL ON FUNCTION public.apply_bulk_permission_action(text,uuid[],text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_bulk_permission_action(text,uuid[],text,uuid,text) TO authenticated;
