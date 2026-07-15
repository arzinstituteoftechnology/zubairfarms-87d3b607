import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type Notification = {
  id: string;
  tenant_id: string | null;
  user_id: string;
  actor_id: string | null;
  type: string;
  title: string;
  message: string;
  priority: "low" | "normal" | "high" | "critical";
  module: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

/**
 * Realtime notification feed for the signed-in user.
 * Uses one Postgres-changes channel scoped to `user_id = auth.uid()`
 * so we don't receive rows we can't read anyway.
 */
export function useNotifications(pageSize = 20) {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(pageSize),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false)
        .is("deleted_at", null),
    ]);
    setItems((data ?? []) as Notification[]);
    setUnread(count ?? 0);
    setLoading(false);
  }, [user, pageSize]);

  useEffect(() => { refresh(); }, [refresh]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => refreshRef.current()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const markRead = useCallback(async (id: string) => {
    await supabase.rpc("mark_notification_read", { _id: id });
    refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    await supabase.rpc("mark_all_notifications_read");
    refresh();
  }, [refresh]);

  const softDelete = useCallback(async (id: string) => {
    await supabase.rpc("soft_delete_notification", { _id: id });
    refresh();
  }, [refresh]);

  return { items, unread, loading, refresh, markRead, markAllRead, softDelete };
}