CREATE OR REPLACE FUNCTION public.tenant_usage(_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _users int; _farms int; _shops int; _trucks int; _backups int; _backup_bytes bigint;
  _reports_30d int; _logins_30d int;
BEGIN
  SELECT count(*) INTO _users FROM public.tenant_users WHERE tenant_id = _tenant_id AND status = 'active';
  SELECT count(*) INTO _farms FROM public.farms WHERE tenant_id = _tenant_id AND deleted_at IS NULL;
  SELECT count(*) INTO _shops FROM public.shops WHERE tenant_id = _tenant_id AND deleted_at IS NULL;
  SELECT count(*) INTO _trucks FROM public.trucks WHERE tenant_id = _tenant_id;
  SELECT count(*), COALESCE(SUM(file_size),0) INTO _backups, _backup_bytes FROM public.backup_history WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _reports_30d FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND action LIKE 'report_%' AND created_at > now() - interval '30 days';
  SELECT count(*) INTO _logins_30d FROM public.activity_logs
    WHERE tenant_id = _tenant_id AND action = 'auth_login' AND created_at > now() - interval '30 days';
  RETURN jsonb_build_object(
    'users', _users, 'farms', _farms, 'shops', _shops, 'trucks', _trucks, 'backups', _backups,
    'backup_storage_mb', ROUND(_backup_bytes::numeric / (1024*1024), 2),
    'reports_last_30d', _reports_30d, 'logins_last_30d', _logins_30d
  );
END $function$;