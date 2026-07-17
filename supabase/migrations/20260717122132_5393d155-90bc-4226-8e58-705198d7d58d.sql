DROP INDEX IF EXISTS public.ux_notifications_dedupe;
CREATE UNIQUE INDEX ux_notifications_dedupe ON public.notifications (user_id, dedupe_key);