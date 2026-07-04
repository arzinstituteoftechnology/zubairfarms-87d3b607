ALTER TABLE public.backup_history DROP CONSTRAINT IF EXISTS backup_history_backup_type_check;
ALTER TABLE public.backup_history ADD CONSTRAINT backup_history_backup_type_check
  CHECK (backup_type = ANY (ARRAY['daily','manual','emergency','pre_restore','monthly','pre_reset','pre_delete']));