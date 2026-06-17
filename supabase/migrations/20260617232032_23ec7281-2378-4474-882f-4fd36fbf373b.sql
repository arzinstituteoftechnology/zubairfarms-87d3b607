
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE existing int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(*) INTO existing FROM public.user_roles WHERE role::text = 'super_admin';
  IF existing > 0 THEN
    INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
    VALUES ('super_admin_bootstrap_blocked', 'super_admin',
            jsonb_build_object('attempted_by', auth.uid()), auth.uid());
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'super_admin'::public.app_role)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.activity_logs (action, entity, metadata, actor_user_id)
  VALUES ('super_admin_bootstrap', 'super_admin',
          jsonb_build_object('user_id', auth.uid()), auth.uid());
  RETURN true;
END;
$$;
