import { supabase } from "@/integrations/supabase/client";

/** Best-effort append to the tenant activity log (never throws). */
export const logActivity = async (action: string, entity: string, entityId: string | null, metadata: Record<string, unknown>, tenantId: string) => {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("activity_logs").insert({
      action, entity, entity_id: entityId, metadata: metadata as any, tenant_id: tenantId, actor_user_id: data.user.id,
    } as any);
  } catch { /* ignore */ }
};
