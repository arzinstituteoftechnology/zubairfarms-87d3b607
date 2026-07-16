
-- Remove duplicate triggers on expenses and recreate notif trigger with correct module name
DROP TRIGGER IF EXISTS notif_expenses ON public.expenses;
DROP TRIGGER IF EXISTS enforce_perm_expenses ON public.expenses;
DROP TRIGGER IF EXISTS trg_audit_financial ON public.expenses;

CREATE TRIGGER enforce_perm_expenses
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_permission_trigger('expenses');

CREATE TRIGGER trg_audit_financial
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_change();

-- Use 'expense' (singular) so notification_type resolves to 'expense_created'
CREATE TRIGGER notif_expenses
  AFTER INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.notif_business_event('expense', 'Expense');

-- Wrap the notification event function so notification failures never rollback
-- the underlying business transaction. Errors are logged to system_errors.
CREATE OR REPLACE FUNCTION public.notif_business_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  EXCEPTION WHEN OTHERS THEN
    -- Never block the underlying business write due to notification failures.
    BEGIN
      PERFORM public.log_system_error(
        COALESCE(_module, TG_TABLE_NAME),
        'notif_business_event failed: ' || SQLERRM,
        'error'::public.system_error_severity,
        NULL,
        jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'sqlstate', SQLSTATE),
        'trigger', NULL, NULL, NULL, _tid
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END $function$;
