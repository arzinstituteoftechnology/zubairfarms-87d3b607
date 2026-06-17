
CREATE POLICY "super admin read backups" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'system-backups' AND public.is_super_admin());
CREATE POLICY "super admin write backups" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'system-backups' AND public.is_super_admin());
CREATE POLICY "super admin update backups" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'system-backups' AND public.is_super_admin());
CREATE POLICY "super admin delete backups" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'system-backups' AND public.is_super_admin());
