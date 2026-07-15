
REVOKE EXECUTE ON FUNCTION public.enqueue_job(text,uuid,jsonb,smallint,text,int,int,int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_jobs(text,int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_job_progress(uuid,numeric,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_job(uuid,jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_job(uuid,text,jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_job(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.retry_job(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_job_now(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_job(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recover_stuck_jobs(int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_background_jobs() FROM anon, authenticated;
