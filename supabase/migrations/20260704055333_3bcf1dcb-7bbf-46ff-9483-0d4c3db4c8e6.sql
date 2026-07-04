SET LOCAL session_replication_role = replica;

UPDATE public.shop_ledger_entries le
   SET reversed_at = COALESCE(le.reversed_at, r.reversed_at, now()),
       reversed_by = COALESCE(le.reversed_by, r.reversed_by),
       reversal_reason = COALESCE(le.reversal_reason, r.reversal_reason),
       reversal_notes = COALESCE(le.reversal_notes, r.reversal_notes),
       reversal_entry_id = COALESCE(le.reversal_entry_id, r.reversal_ledger_entry_id)
  FROM public.shop_recoveries r
 WHERE r.ledger_entry_id = le.id
   AND r.reversed_at IS NOT NULL
   AND le.reversed_at IS NULL
   AND le.entry_type = 'recovery';