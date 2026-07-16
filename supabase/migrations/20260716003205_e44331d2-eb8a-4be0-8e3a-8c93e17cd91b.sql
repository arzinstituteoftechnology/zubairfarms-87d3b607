
-- 1) Financial audit logger.
CREATE OR REPLACE FUNCTION public.audit_financial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tid uuid; _eid text; _amount numeric; _old jsonb; _new jsonb;
  _headers jsonb; _ip text; _ua text; _reverse_ref text;
BEGIN
  _old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  _new := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  _tid := COALESCE(NULLIF(COALESCE(_new->>'tenant_id', _old->>'tenant_id'), '')::uuid, public.current_tenant_id());
  _eid := COALESCE(_new->>'id', _old->>'id');
  _amount := COALESCE(
    NULLIF(_new->>'total_amount','')::numeric, NULLIF(_new->>'amount','')::numeric,
    NULLIF(_old->>'total_amount','')::numeric, NULLIF(_old->>'amount','')::numeric);
  _reverse_ref := COALESCE(_new->>'original_entry_id', _new->>'reversal_ledger_entry_id',
    _new->>'reversal_entry_id', _old->>'original_entry_id',
    _old->>'reversal_ledger_entry_id', _old->>'reversal_entry_id');
  BEGIN _headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN _headers := NULL; END;
  _ip := COALESCE(_headers->>'x-forwarded-for', _headers->>'cf-connecting-ip');
  _ua := _headers->>'user-agent';

  INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata, actor_user_id)
  VALUES (
    lower(TG_TABLE_NAME) || '_' || lower(TG_OP), TG_TABLE_NAME, _eid, _tid,
    jsonb_build_object(
      'module', TG_TABLE_NAME, 'op', TG_OP, 'amount', _amount,
      'reverse_ref', _reverse_ref, 'ip', _ip, 'user_agent', _ua,
      'old', _old, 'new', _new),
    auth.uid()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2) Attach audit trigger to every financial table.
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'purchases','supplies','shop_recoveries','expenses','farm_payments',
    'supplier_ledger_entries','shop_ledger_entries','stock_adjustments','stock_closings',
    'pos_sales','customer_payments','payments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_financial ON public.%I', _t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_financial AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_financial_change()',
      _t);
  END LOOP;
END $$;

-- 3) Append-only guard on activity_logs.
CREATE OR REPLACE FUNCTION public.activity_logs_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'activity_logs is append-only; % is not allowed', TG_OP USING ERRCODE = '42501'; END;
$$;
DROP TRIGGER IF EXISTS trg_activity_logs_no_update ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_no_update BEFORE UPDATE ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.activity_logs_append_only();
DROP TRIGGER IF EXISTS trg_activity_logs_no_delete ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_no_delete BEFORE DELETE ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.activity_logs_append_only();

-- 4) Repair the single orphan reversal — bypass triggers to avoid firing stale notification enums.
SET LOCAL session_replication_role = 'replica';

UPDATE public.supplies s
SET reversed_at = COALESCE(s.reversed_at, l.created_at, now()),
    reversed_by = COALESCE(s.reversed_by, l.created_by),
    reversal_reason = COALESCE(s.reversal_reason, l.reversal_reason, 'Backfilled from orphan ledger entry'),
    reversal_notes  = COALESCE(s.reversal_notes,  l.reversal_notes),
    reversal_ledger_entry_id = COALESCE(s.reversal_ledger_entry_id, l.id)
FROM public.shop_ledger_entries l
WHERE l.id = '5547c942-59f1-4b0d-97a4-527b9d632f79'
  AND s.id = '33415e14-e287-411c-a880-de960a3acb5f';

UPDATE public.shop_ledger_entries
SET original_entry_id = '33415e14-e287-411c-a880-de960a3acb5f'
WHERE id = '5547c942-59f1-4b0d-97a4-527b9d632f79'
  AND original_entry_id IS NULL;

SET LOCAL session_replication_role = 'origin';

-- 5) Audit the repair itself so the trail is complete.
INSERT INTO public.activity_logs (action, entity, entity_id, tenant_id, metadata)
VALUES (
  'orphan_reversal_repaired', 'supplies', '33415e14-e287-411c-a880-de960a3acb5f',
  '9296b969-3db9-4956-95d8-b80256f1b09a',
  jsonb_build_object(
    'ledger_entry_id','5547c942-59f1-4b0d-97a4-527b9d632f79',
    'reason','Enterprise accounting finalization backfill',
    'amount',65512.00)
);
