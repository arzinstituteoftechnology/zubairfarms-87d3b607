-- Change collected_by from uuid to text to allow any collector name
ALTER TABLE public.shop_recoveries ALTER COLUMN collected_by TYPE text USING collected_by::text;

-- Update the sync trigger to include collector name in the ledger description
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