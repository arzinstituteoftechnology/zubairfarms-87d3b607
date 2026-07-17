
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'subscription_expiring';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'subscription_expired';
