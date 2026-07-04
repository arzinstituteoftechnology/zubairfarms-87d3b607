SET LOCAL session_replication_role = replica;

UPDATE public.shop_ledger_entries le
SET reversed_at = COALESCE(le.reversed_at, sr.reversed_at),
    reversed_by = COALESCE(le.reversed_by, sr.reversed_by),
    reversal_reason = COALESCE(le.reversal_reason, sr.reversal_reason),
    reversal_notes = COALESCE(le.reversal_notes, sr.reversal_notes),
    reversal_entry_id = COALESCE(le.reversal_entry_id, sr.reversal_ledger_entry_id)
FROM public.shop_recoveries sr
WHERE sr.ledger_entry_id = le.id
  AND sr.reversed_at IS NOT NULL
  AND le.entry_type::text = 'recovery'
  AND le.reversed_at IS NULL;

UPDATE public.shop_ledger_entries rev
SET original_entry_id = sr.ledger_entry_id
FROM public.shop_recoveries sr
WHERE sr.reversal_ledger_entry_id = rev.id
  AND sr.ledger_entry_id IS NOT NULL
  AND rev.original_entry_id IS NULL
  AND rev.entry_type::text = 'reversed_recovery';

RESET session_replication_role;