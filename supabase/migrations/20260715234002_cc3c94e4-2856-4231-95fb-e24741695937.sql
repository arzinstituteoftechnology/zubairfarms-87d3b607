
-- ============================================================
-- 1. ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.notification_priority AS ENUM ('low','normal','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'purchase_created','purchase_reversed',
    'supply_created','supply_reversed',
    'recovery_created','recovery_reversed',
    'expense_created',
    'farm_payment_created','farm_payment_reversed',
    'customer_payment_created',
    'stock_closing_created',
    'stock_adjustment_created','stock_adjustment_reversed',
    'ledger_entry_created','ledger_entry_reversed',
    'daily_closing_finalized',
    'factory_reset','business_reset',
    'backup_created','backup_restored','backup_failed',
    'user_created','user_updated','user_removed',
    'permission_changed','role_permission_changed',
    'password_changed','login_alert',
    'super_admin_login',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,     -- recipient (auth.uid). No FK to auth.users.
  actor_id     uuid,              -- who caused the event
  type         public.notification_type NOT NULL,
  title        text NOT NULL,
  message      text NOT NULL,
  priority     public.notification_priority NOT NULL DEFAULT 'normal',
  module       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key   text,              -- prevents duplicates from a single event
  is_read      boolean NOT NULL DEFAULT false,
  read_at      timestamptz,
  deleted_at   timestamptz,       -- soft delete
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created
  ON public.notifications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_module
  ON public.notifications (tenant_id, module, created_at DESC);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "sa reads all notifications" ON public.notifications
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "user updates own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Preferences: one row per user per module (or user + '_all')
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  tenant_id    uuid,
  module       text NOT NULL DEFAULT '_all',    -- '_all' or a specific module
  in_app       boolean NOT NULL DEFAULT true,
  email        boolean NOT NULL DEFAULT false,
  min_priority public.notification_priority NOT NULL DEFAULT 'low',
  muted_until  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages own prefs" ON public.notification_preferences
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_notif_prefs_touch ON public.notification_preferences;
CREATE TRIGGER trg_notif_prefs_touch BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Email outbox
CREATE TABLE IF NOT EXISTS public.email_notification_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  tenant_id       uuid,
  recipient_user_id uuid NOT NULL,
  recipient_email text NOT NULL,
  template        text NOT NULL DEFAULT 'notification-generic',
  template_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending',   -- pending | sending | sent | failed | dlq
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_queue_ready
  ON public.email_notification_queue (status, next_attempt_at) WHERE status IN ('pending','failed');
GRANT SELECT ON public.email_notification_queue TO authenticated;
GRANT ALL  ON public.email_notification_queue TO service_role;
ALTER TABLE public.email_notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sa reads email queue" ON public.email_notification_queue
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_email_queue_touch ON public.email_notification_queue;
CREATE TRIGGER trg_email_queue_touch BEFORE UPDATE ON public.email_notification_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 3. REALTIME
-- ============================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. CORE HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_admins_of_tenant(
  _tenant_id  uuid,
  _actor      uuid,
  _type       public.notification_type,
  _title      text,
  _message    text,
  _priority   public.notification_priority,
  _module     text,
  _entity_type text,
  _entity_id  uuid,
  _metadata   jsonb,
  _dedupe     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec record; _pref record; _email text;
BEGIN
  IF _tenant_id IS NULL THEN RETURN; END IF;

  FOR _rec IN
    SELECT tu.user_id
    FROM public.tenant_users tu
    WHERE tu.tenant_id = _tenant_id
      AND tu.status = 'active'
      AND tu.tenant_role IN ('owner','admin')
  LOOP
    -- Per-user preference lookup (specific module, then '_all', else default enabled)
    SELECT * INTO _pref FROM public.notification_preferences
      WHERE user_id = _rec.user_id AND module = _module LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO _pref FROM public.notification_preferences
        WHERE user_id = _rec.user_id AND module = '_all' LIMIT 1;
    END IF;

    -- Respect mute window
    IF _pref.muted_until IS NOT NULL AND _pref.muted_until > now() THEN CONTINUE; END IF;
    -- Respect min priority
    IF _pref.min_priority IS NOT NULL AND
       array_position(ARRAY['low','normal','high','critical']::text[], _priority::text)
       < array_position(ARRAY['low','normal','high','critical']::text[], _pref.min_priority::text)
    THEN CONTINUE; END IF;

    IF COALESCE(_pref.in_app, true) THEN
      INSERT INTO public.notifications
        (tenant_id, user_id, actor_id, type, title, message, priority,
         module, entity_type, entity_id, metadata, dedupe_key)
      VALUES
        (_tenant_id, _rec.user_id, _actor, _type, _title, _message, _priority,
         _module, _entity_type, _entity_id, COALESCE(_metadata, '{}'::jsonb),
         CASE WHEN _dedupe IS NULL THEN NULL ELSE _dedupe END)
      ON CONFLICT (user_id, dedupe_key) DO NOTHING;
    END IF;

    -- Queue email if opted in
    IF COALESCE(_pref.email, false) THEN
      SELECT email INTO _email FROM auth.users WHERE id = _rec.user_id;
      IF _email IS NOT NULL THEN
        INSERT INTO public.email_notification_queue
          (tenant_id, recipient_user_id, recipient_email, template, template_data)
        VALUES (_tenant_id, _rec.user_id, _email, 'notification-generic',
          jsonb_build_object('title', _title, 'message', _message, 'priority', _priority, 'module', _module, 'metadata', COALESCE(_metadata,'{}'::jsonb)));
      END IF;
    END IF;
  END LOOP;
END $$;

-- Also notify super admins (for cross-tenant events: backup/restore/reset/SA login)
CREATE OR REPLACE FUNCTION public.notify_super_admins(
  _actor      uuid,
  _type       public.notification_type,
  _title      text,
  _message    text,
  _priority   public.notification_priority,
  _module     text,
  _entity_type text,
  _entity_id  uuid,
  _metadata   jsonb,
  _dedupe     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec record;
BEGIN
  FOR _rec IN SELECT user_id FROM public.user_roles WHERE role = 'super_admin' LOOP
    INSERT INTO public.notifications
      (tenant_id, user_id, actor_id, type, title, message, priority,
       module, entity_type, entity_id, metadata, dedupe_key)
    VALUES
      (NULL, _rec.user_id, _actor, _type, _title, _message, _priority,
       _module, _entity_type, _entity_id, COALESCE(_metadata,'{}'::jsonb), _dedupe)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- 5. GENERIC BUSINESS-EVENT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.notif_business_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _module text  := TG_ARGV[0];
  _label  text  := TG_ARGV[1];
  _title  text;
  _msg    text;
  _prio   public.notification_priority := 'normal';
  _type   public.notification_type;
  _tid    uuid;
  _eid    uuid;
  _rev_was_null boolean;
  _rev_is_null  boolean;
  _amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _tid := (to_jsonb(NEW)->>'tenant_id')::uuid;
    _eid := (to_jsonb(NEW)->>'id')::uuid;
    _amount := COALESCE(NULLIF(to_jsonb(NEW)->>'total_amount','')::numeric,
                        NULLIF(to_jsonb(NEW)->>'amount','')::numeric, 0);
    _type := (_module || '_created')::public.notification_type;
    _title := _label || ' recorded';
    _msg  := _label || ' entry created' ||
             CASE WHEN _amount > 0 THEN ' — amount ' || to_char(_amount,'FM999,999,990.00') ELSE '' END;
    PERFORM public.notify_admins_of_tenant(
      _tid, auth.uid(), _type, _title, _msg, _prio,
      _module, TG_TABLE_NAME, _eid,
      jsonb_build_object('op','INSERT','row', to_jsonb(NEW)),
      'insert:' || TG_TABLE_NAME || ':' || _eid::text
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Fire ONCE when reversed_at transitions from NULL -> not-null.
    _rev_was_null := (to_jsonb(OLD) ? 'reversed_at') AND (to_jsonb(OLD)->>'reversed_at') IS NULL;
    _rev_is_null  := (to_jsonb(NEW) ? 'reversed_at') AND (to_jsonb(NEW)->>'reversed_at') IS NULL;
    IF _rev_was_null AND NOT _rev_is_null THEN
      _tid := (to_jsonb(NEW)->>'tenant_id')::uuid;
      _eid := (to_jsonb(NEW)->>'id')::uuid;
      _type := (_module || '_reversed')::public.notification_type;
      _prio := 'high';
      _title := _label || ' reversed';
      _msg  := _label || ' entry reversed — ' || COALESCE(to_jsonb(NEW)->>'reversal_reason','no reason provided');
      PERFORM public.notify_admins_of_tenant(
        _tid, auth.uid(), _type, _title, _msg, _prio,
        _module, TG_TABLE_NAME, _eid,
        jsonb_build_object('op','REVERSE','row', to_jsonb(NEW)),
        'reverse:' || TG_TABLE_NAME || ':' || _eid::text
      );
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- Attach to business tables
DO $$
DECLARE m text[][] := ARRAY[
  ARRAY['purchases',      'purchases',      'Purchase'],
  ARRAY['supplies',       'supplies',       'Supply'],
  ARRAY['shop_recoveries','recovery',       'Recovery'],
  ARRAY['expenses',       'expenses',       'Expense'],
  ARRAY['farm_payments',  'farm_payment',   'Farm payment'],
  ARRAY['customer_payments','customer_payment','Customer payment'],
  ARRAY['stock_closings', 'stock_closing',  'Daily closing'],
  ARRAY['stock_adjustments','stock_adjustment','Stock adjustment']
];
  i int;
BEGIN
  FOR i IN 1..array_length(m,1) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS notif_%s ON public.%s', m[i][1], m[i][1]);
    EXECUTE format(
      'CREATE TRIGGER notif_%s AFTER INSERT OR UPDATE ON public.%s
       FOR EACH ROW EXECUTE FUNCTION public.notif_business_event(%L, %L)',
      m[i][1], m[i][1], m[i][2], m[i][3]);
  END LOOP;
END $$;

-- Supplier & shop ledger entries: manual entries + reversals
CREATE OR REPLACE FUNCTION public.notif_ledger_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _tid uuid; _eid uuid; _ltype text; _amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _tid := NEW.tenant_id; _eid := NEW.id;
    _ltype := NEW.entry_type::text; _amount := COALESCE(NEW.amount,0);
    IF _ltype LIKE 'reversed_%' THEN
      PERFORM public.notify_admins_of_tenant(
        _tid, auth.uid(), 'ledger_entry_reversed'::public.notification_type,
        'Ledger reversal', TG_TABLE_NAME || ': ' || _ltype || ' — ' || to_char(_amount,'FM999,999,990.00'),
        'high', TG_TABLE_NAME, TG_TABLE_NAME, _eid,
        jsonb_build_object('row', to_jsonb(NEW)),
        'ledger_reverse:' || TG_TABLE_NAME || ':' || _eid::text);
    ELSIF _ltype IN ('manual_purchase','manual_payment','manual_supply',
                     'adjustment_increase','adjustment_decrease','opening_balance') THEN
      PERFORM public.notify_admins_of_tenant(
        _tid, auth.uid(), 'ledger_entry_created'::public.notification_type,
        'Ledger entry', TG_TABLE_NAME || ': ' || _ltype || ' — ' || to_char(_amount,'FM999,999,990.00'),
        'normal', TG_TABLE_NAME, TG_TABLE_NAME, _eid,
        jsonb_build_object('row', to_jsonb(NEW)),
        'ledger_insert:' || TG_TABLE_NAME || ':' || _eid::text);
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS notif_supplier_ledger ON public.supplier_ledger_entries;
CREATE TRIGGER notif_supplier_ledger AFTER INSERT ON public.supplier_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.notif_ledger_event();
DROP TRIGGER IF EXISTS notif_shop_ledger ON public.shop_ledger_entries;
CREATE TRIGGER notif_shop_ledger AFTER INSERT ON public.shop_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.notif_ledger_event();

-- ============================================================
-- 6. USER / PERMISSION EVENTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.notif_perm_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _tid uuid; _eid uuid; _title text; _msg text; _type public.notification_type;
BEGIN
  _tid := COALESCE((to_jsonb(NEW)->>'tenant_id')::uuid,
                   (to_jsonb(OLD)->>'tenant_id')::uuid,
                   public.current_tenant_id());
  _eid := COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);

  IF TG_TABLE_NAME = 'tenant_users' THEN
    IF TG_OP = 'INSERT' THEN
      _type := 'user_created';  _title := 'User added';
      _msg  := 'A ' || NEW.tenant_role || ' user was added to the account.';
    ELSIF TG_OP = 'DELETE' THEN
      _type := 'user_removed';  _title := 'User removed';
      _msg  := 'A user was removed from the account.';
    ELSE
      _type := 'user_updated';  _title := 'User updated';
      _msg  := 'User role/status changed: ' || COALESCE(OLD.tenant_role,'?') || '/' || COALESCE(OLD.status,'?')
              || ' -> ' || COALESCE(NEW.tenant_role,'?') || '/' || COALESCE(NEW.status,'?');
    END IF;
  ELSIF TG_TABLE_NAME = 'role_permissions' THEN
    _type := 'role_permission_changed'; _title := 'Role permission updated';
    _msg  := 'Role permissions changed (' || TG_OP || ').';
  ELSE  -- user_permission_overrides
    _type := 'permission_changed';       _title := 'User permission changed';
    _msg  := 'A per-user permission was ' || lower(TG_OP) || '.';
  END IF;

  PERFORM public.notify_admins_of_tenant(
    _tid, auth.uid(), _type, _title, _msg, 'high',
    'users_permissions', TG_TABLE_NAME, _eid,
    jsonb_build_object('op', TG_OP,
      'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
      'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END),
    'perm:' || TG_TABLE_NAME || ':' || _eid::text || ':' || TG_OP
  );
  RETURN COALESCE(NEW, OLD);
END $fn$;

DROP TRIGGER IF EXISTS notif_tenant_users ON public.tenant_users;
CREATE TRIGGER notif_tenant_users AFTER INSERT OR UPDATE OR DELETE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.notif_perm_event();
DROP TRIGGER IF EXISTS notif_role_perms ON public.role_permissions;
CREATE TRIGGER notif_role_perms AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.notif_perm_event();
DROP TRIGGER IF EXISTS notif_user_overrides ON public.user_permission_overrides;
CREATE TRIGGER notif_user_overrides AFTER INSERT OR UPDATE OR DELETE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.notif_perm_event();

-- ============================================================
-- 7. BACKUP HISTORY EVENTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.notif_backup_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _title text; _msg text; _type public.notification_type; _prio public.notification_priority;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;  -- fire on status transitions
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('success','warning') THEN
    _type := 'backup_created'; _prio := 'normal';
    _title := 'Backup created'; _msg := coalesce(NEW.backup_name, NEW.backup_type || ' backup') || ' completed.';
  ELSIF NEW.status = 'failed' THEN
    _type := 'backup_failed';  _prio := 'critical';
    _title := 'Backup failed';  _msg := coalesce(NEW.error_message,'Unknown error');
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM public.notify_admins_of_tenant(
      NEW.tenant_id, NEW.created_by, _type, _title, _msg, _prio,
      'backup', 'backup_history', NEW.id,
      jsonb_build_object('backup_type', NEW.backup_type, 'name', NEW.backup_name),
      'backup:' || NEW.id::text || ':' || NEW.status);
  END IF;
  PERFORM public.notify_super_admins(
    NEW.created_by, _type, _title, _msg, _prio, 'backup',
    'backup_history', NEW.id,
    jsonb_build_object('backup_type', NEW.backup_type, 'tenant_id', NEW.tenant_id),
    'sa_backup:' || NEW.id::text || ':' || NEW.status);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS notif_backup_history ON public.backup_history;
CREATE TRIGGER notif_backup_history AFTER UPDATE ON public.backup_history
  FOR EACH ROW EXECUTE FUNCTION public.notif_backup_event();

-- ============================================================
-- 8. RPCs USED BY THE UI
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_notification_read(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notifications SET is_read = true, read_at = now()
   WHERE id = _id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.notifications SET is_read = true, read_at = now()
    WHERE user_id = auth.uid() AND is_read = false AND deleted_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.soft_delete_notification(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notifications SET deleted_at = now()
   WHERE id = _id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_notification(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_admins_of_tenant(uuid,uuid,public.notification_type,text,text,public.notification_priority,text,text,uuid,jsonb,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_super_admins(uuid,public.notification_type,text,text,public.notification_priority,text,text,uuid,jsonb,text) FROM anon, authenticated;
