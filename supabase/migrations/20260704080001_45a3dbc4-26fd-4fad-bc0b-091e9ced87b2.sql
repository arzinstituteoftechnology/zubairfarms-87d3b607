
-- Allow service-role / system operations (auth.uid() IS NULL) to pass through.
-- Signed-in users are still checked exactly as before.
CREATE OR REPLACE FUNCTION public.enforce_current_tenant_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
BEGIN
  -- System / service-role writes (edge functions, migrations, cron) have no auth.uid().
  -- Trust the row's tenant_id as-is and skip the guard.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  _tenant_id := public.current_tenant_id();

  IF _tenant_id IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Account is not linked to a client. Please sign in with a tenant admin account created by the super admin.' USING ERRCODE = '42501';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := _tenant_id;
  END IF;

  IF NOT public.is_super_admin() AND NEW.tenant_id <> _tenant_id THEN
    RAISE EXCEPTION 'Cannot create records for another client account.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() AND NOT public.tenant_has_active_subscription(_tenant_id) THEN
    RAISE EXCEPTION 'Client subscription is not active. Please contact the super admin.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- On system-level DELETE (no auth.uid()), do not auto-insert a reversal ledger row.
-- The whole tenant is being wiped, so a "reversed_recovery" entry serves no purpose
-- and would fail the tenant guard anyway.
CREATE OR REPLACE FUNCTION public.sync_recovery_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _desc text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Skip the reversal-entry auto-insert during system/service-role wipes.
    IF auth.uid() IS NULL THEN
      RETURN OLD;
    END IF;
    IF OLD.ledger_entry_id IS NOT NULL THEN
      INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
      VALUES (
        OLD.tenant_id, OLD.shop_id, 'reversed_recovery', CURRENT_DATE,
        'Reversed recovery (' || OLD.payment_method || ', ' || OLD.recovery_date || ')'
          || COALESCE(' — Collector: ' || NULLIF(OLD.collected_by, ''), '')
          || COALESCE(' — ' || NULLIF(OLD.notes, ''), ''),
        OLD.amount, OLD.created_by
      );
    END IF;
    RETURN OLD;
  END IF;

  _desc := 'Recovery (' || NEW.payment_method || ')'
    || COALESCE(' — Collector: ' || NULLIF(NEW.collected_by, ''), '')
    || COALESCE(' — ' || NULLIF(NEW.notes, ''), '');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
    VALUES (NEW.tenant_id, NEW.shop_id, 'recovery', NEW.recovery_date, _desc, NEW.amount, NEW.created_by)
    RETURNING id INTO NEW.ledger_entry_id;
    UPDATE public.shop_recoveries SET ledger_entry_id = NEW.ledger_entry_id WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.ledger_entry_id IS NULL THEN
      INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
      VALUES (NEW.tenant_id, NEW.shop_id, 'recovery', NEW.recovery_date, _desc, NEW.amount, NEW.created_by)
      RETURNING id INTO NEW.ledger_entry_id;
    ELSE
      UPDATE public.shop_ledger_entries
        SET shop_id = NEW.shop_id,
            entry_date = NEW.recovery_date,
            description = _desc,
            amount = NEW.amount
        WHERE id = NEW.ledger_entry_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;
