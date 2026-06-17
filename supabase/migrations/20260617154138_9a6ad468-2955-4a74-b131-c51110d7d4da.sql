CREATE OR REPLACE FUNCTION public.sync_recovery_to_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _desc text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Reverse: keep the original recovery ledger entry, add a counter debit entry
    IF OLD.ledger_entry_id IS NOT NULL THEN
      INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
      VALUES (
        OLD.tenant_id, OLD.shop_id, 'reversed_recovery', CURRENT_DATE,
        'Reversed recovery (' || OLD.payment_method || ', ' || OLD.recovery_date || ')'
          || COALESCE(' — ' || NULLIF(OLD.notes, ''), ''),
        OLD.amount, OLD.created_by
      );
    END IF;
    RETURN OLD;
  END IF;

  _desc := 'Recovery (' || NEW.payment_method || ')'
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

-- Backfill any existing recoveries that failed to create ledger entries previously (enum was missing)
INSERT INTO public.shop_ledger_entries (tenant_id, shop_id, entry_type, entry_date, description, amount, created_by)
SELECT r.tenant_id, r.shop_id, 'recovery', r.recovery_date,
       'Recovery (' || r.payment_method || ')' || COALESCE(' — ' || NULLIF(r.notes, ''), ''),
       r.amount, r.created_by
FROM public.shop_recoveries r
WHERE r.ledger_entry_id IS NULL;

UPDATE public.shop_recoveries r
SET ledger_entry_id = e.id
FROM public.shop_ledger_entries e
WHERE r.ledger_entry_id IS NULL
  AND e.shop_id = r.shop_id
  AND e.entry_type = 'recovery'
  AND e.entry_date = r.recovery_date
  AND e.amount = r.amount;