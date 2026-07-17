
CREATE TABLE IF NOT EXISTS public.sms_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gatewayapi',
  sender_id TEXT,
  admin_phone TEXT,
  country_code TEXT NOT NULL DEFAULT '+92',
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  notify_admin BOOLEAN NOT NULL DEFAULT true,
  notify_customer BOOLEAN NOT NULL DEFAULT true,
  admin_notification_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_notification_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_settings TO authenticated;
GRANT ALL ON public.sms_settings TO service_role;
ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_settings owner manager access"
  ON public.sms_settings FOR ALL TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)))
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)));

CREATE TRIGGER trg_sms_settings_uat BEFORE UPDATE ON public.sms_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.sms_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('admin','customer','shop','farm','supplier','user')),
  template_name TEXT NOT NULL,
  message_body TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_type, recipient_type, language)
);

CREATE INDEX IF NOT EXISTS idx_sms_templates_lookup
  ON public.sms_templates (tenant_id, event_type, recipient_type, is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_templates TO authenticated;
GRANT ALL ON public.sms_templates TO service_role;
ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_templates owner manager access"
  ON public.sms_templates FOR ALL TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)))
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)));

CREATE TRIGGER trg_sms_templates_uat BEFORE UPDATE ON public.sms_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.sms_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  related_table TEXT,
  related_record_id UUID,
  recipient_type TEXT NOT NULL,
  recipient_name TEXT,
  phone_number TEXT NOT NULL,
  message_body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gatewayapi',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','delivered','failed','cancelled','skipped')),
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  provider_message_id TEXT,
  provider_status TEXT,
  error_message TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON public.sms_queue (tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sms_queue_event ON public.sms_queue (tenant_id, event_type, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_queue TO authenticated;
GRANT ALL ON public.sms_queue TO service_role;
ALTER TABLE public.sms_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_queue owner manager access"
  ON public.sms_queue FOR ALL TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)))
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)));

CREATE TRIGGER trg_sms_queue_uat BEFORE UPDATE ON public.sms_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.sms_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sms_queue_id UUID REFERENCES public.sms_queue(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  phone_number_masked TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_tenant ON public.sms_delivery_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_queue ON public.sms_delivery_logs (sms_queue_id);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_provider_msg ON public.sms_delivery_logs (provider_message_id);

GRANT SELECT, INSERT ON public.sms_delivery_logs TO authenticated;
GRANT ALL ON public.sms_delivery_logs TO service_role;
ALTER TABLE public.sms_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_delivery_logs owner manager read"
  ON public.sms_delivery_logs FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)));

CREATE POLICY "sms_delivery_logs owner manager insert"
  ON public.sms_delivery_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR (tenant_id = public.current_tenant_id() AND public.is_tenant_manager_or_owner(auth.uid(), tenant_id)));

CREATE OR REPLACE FUNCTION public.seed_sms_default_templates(_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin()
     AND NOT public.is_tenant_manager_or_owner(auth.uid(), _tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.sms_templates (tenant_id, event_type, recipient_type, template_name, message_body, language) VALUES
    (_tenant_id, 'supply_created',      'admin', 'Admin: Supply Created',
      'MeatFlow: Supply recorded. Shop: {{shop_name}}, Weight: {{weight}} kg, Amount: Rs {{amount}}, Date: {{date}}, Entry ID: {{reference}}.', 'en'),
    (_tenant_id, 'supply_created',      'shop',  'Shop: Supply Created',
      'Dear {{customer_name}}, {{weight}} kg supply worth Rs {{amount}} has been added to your account on {{date}}. Outstanding balance: Rs {{balance}}. Ref: {{reference}}.', 'en'),
    (_tenant_id, 'recovery_created',    'admin', 'Admin: Recovery Received',
      'MeatFlow: Recovery received from {{shop_name}}. Amount: Rs {{amount}}, Date: {{date}}, Remaining receivable: Rs {{balance}}. Ref: {{reference}}.', 'en'),
    (_tenant_id, 'recovery_created',    'shop',  'Shop: Recovery Received',
      'Dear {{customer_name}}, your payment of Rs {{amount}} has been received on {{date}}. Remaining balance: Rs {{balance}}. Ref: {{reference}}.', 'en'),
    (_tenant_id, 'purchase_created',    'admin', 'Admin: Purchase Recorded',
      'MeatFlow: Purchase recorded from {{farm_name}}. Weight: {{weight}} kg, Amount: Rs {{amount}}, Date: {{date}}. Ref: {{reference}}.', 'en'),
    (_tenant_id, 'farm_payment_created','farm',  'Farm: Payment Recorded',
      'Dear {{farm_name}}, payment of Rs {{amount}} has been recorded on {{date}}. Remaining payable: Rs {{balance}}. Ref: {{reference}}.', 'en'),
    (_tenant_id, 'expense_created',     'admin', 'Admin: Expense Recorded',
      'MeatFlow: Expense recorded. Category: {{category}}, Amount: Rs {{amount}}, Date: {{date}}, Notes: {{notes}}.', 'en'),
    (_tenant_id, 'closing_finalized',   'admin', 'Admin: Closing Finalized',
      'MeatFlow: Daily closing finalized for {{date}}. Expected: {{expected}} kg, Physical: {{physical}} kg, Variance: {{variance}} kg, Status: {{status}}.', 'en'),
    (_tenant_id, 'shortage_recorded',   'admin', 'Admin: Shortage Alert',
      'Alert: Stock shortage recorded on {{date}}. Shortage: {{shortage}} kg, Cost impact: Rs {{shortage_cost}}, Reason: {{reason}}.', 'en'),
    (_tenant_id, 'backup_failed',       'admin', 'Admin: Backup Failed',
      'Critical Alert: MeatFlow backup failed for {{tenant_name}} at {{datetime}}. Error: {{error_summary}}.', 'en')
  ON CONFLICT (tenant_id, event_type, recipient_type, language) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_sms_default_templates(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_sms_settings(_tenant_id UUID)
RETURNS public.sms_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.sms_settings;
BEGIN
  IF NOT public.is_super_admin()
     AND NOT public.is_tenant_manager_or_owner(auth.uid(), _tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO _row FROM public.sms_settings WHERE tenant_id = _tenant_id;
  IF NOT FOUND THEN
    INSERT INTO public.sms_settings (tenant_id) VALUES (_tenant_id) RETURNING * INTO _row;
    PERFORM public.seed_sms_default_templates(_tenant_id);
  END IF;
  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_sms_settings(UUID) TO authenticated;
