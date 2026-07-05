
CREATE POLICY "logos_read_tenant" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'business-logos' AND (public.is_super_admin() OR (split_part(name, '/', 1))::uuid = public.current_tenant_id()));

CREATE POLICY "logos_write_owner" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'business-logos' AND (public.is_super_admin() OR ((split_part(name, '/', 1))::uuid = public.current_tenant_id() AND public.is_tenant_owner(auth.uid()))));

CREATE POLICY "logos_update_owner" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'business-logos' AND (public.is_super_admin() OR ((split_part(name, '/', 1))::uuid = public.current_tenant_id() AND public.is_tenant_owner(auth.uid()))));

CREATE POLICY "logos_delete_owner" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'business-logos' AND (public.is_super_admin() OR ((split_part(name, '/', 1))::uuid = public.current_tenant_id() AND public.is_tenant_owner(auth.uid()))));
