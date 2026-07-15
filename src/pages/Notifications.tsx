import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCheck, Trash2, Bell, Settings2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SeoHead } from "@/components/SeoHead";

const MODULES = ["all","purchases","supplies","daily_recovery","expenses","farm_payments","shop_ledger","supplier_ledger","users_permissions","backup","stock_closing"];
const PRIORITIES = ["all","low","normal","high","critical"];

type Pref = {
  id?: string;
  user_id: string;
  module: string;
  in_app: boolean;
  email: boolean;
  min_priority: "low"|"normal"|"high"|"critical";
  muted_until: string | null;
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const { markRead, markAllRead, softDelete } = useNotifications(1);
  const [items, setItems] = useState<Notification[]>([]);
  const [tab, setTab] = useState<"all"|"unread">("all");
  const [module, setModule] = useState("all");
  const [priority, setPriority] = useState("all");
  const [q, setQ] = useState("");
  const [prefs, setPrefs] = useState<Pref | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  const load = async () => {
    if (!user) return;
    let query = supabase.from("notifications").select("*")
      .eq("user_id", user.id).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(200);
    if (tab === "unread") query = query.eq("is_read", false);
    if (module !== "all") query = query.eq("module", module);
    if (priority !== "all") query = query.eq("priority", priority as any);
    const { data } = await query;
    setItems((data ?? []) as Notification[]);
  };

  const loadPrefs = async () => {
    if (!user) return;
    const { data } = await supabase.from("notification_preferences")
      .select("*").eq("user_id", user.id).eq("module", "_all").maybeSingle();
    setPrefs(data ?? { user_id: user.id, module: "_all", in_app: true, email: false, min_priority: "low", muted_until: null });
  };

  useEffect(() => { load(); }, [user, tab, module, priority]);
  useEffect(() => { loadPrefs(); }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif-page-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const filtered = useMemo(() => {
    if (!q) return items;
    const s = q.toLowerCase();
    return items.filter(n => n.title.toLowerCase().includes(s) || n.message.toLowerCase().includes(s));
  }, [items, q]);

  const savePrefs = async () => {
    if (!prefs || !user) return;
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: user.id, module: "_all",
      in_app: prefs.in_app, email: prefs.email,
      min_priority: prefs.min_priority, muted_until: prefs.muted_until,
    }, { onConflict: "user_id,module" });
    if (error) toast.error(error.message); else toast.success("Preferences saved");
  };

  return (
    <div className="space-y-4">
      <SeoHead title="Notifications" description="View and manage your notification feed" path="/notifications" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Bell className="h-6 w-6" /> Notifications</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => markAllRead().then(load)}>
            <CheckCheck className="h-4 w-4 mr-1" /> Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowPrefs(!showPrefs)}>
            <Settings2 className="h-4 w-4 mr-1" /> Preferences
          </Button>
        </div>
      </div>

      {showPrefs && prefs && (
        <Card className="p-4 space-y-3">
          <div className="font-medium">Notification Preferences</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">In-app notifications</div>
              <div className="text-xs text-muted-foreground">Receive real-time notifications in the app</div>
            </div>
            <Switch checked={prefs.in_app} onCheckedChange={(v) => setPrefs({ ...prefs, in_app: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Email notifications</div>
              <div className="text-xs text-muted-foreground">
                Queue notifications for email delivery
                <Badge variant="outline" className="ml-2 text-[10px]">Pending Production Setup</Badge>
              </div>
            </div>
            <Switch checked={prefs.email} onCheckedChange={(v) => setPrefs({ ...prefs, email: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">Minimum priority</div>
            <Select value={prefs.min_priority} onValueChange={(v) => setPrefs({ ...prefs, min_priority: v as any })}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["low","normal","high","critical"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={savePrefs}>Save preferences</Button>
          </div>
        </Card>
      )}

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={module} onValueChange={setModule}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Module" /></SelectTrigger>
          <SelectContent>{MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Search title or message…" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>

      <Card className="divide-y">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No notifications match your filters</div>
        ) : filtered.map(n => (
          <div key={n.id} className={cn("p-4 flex items-start gap-3", !n.is_read && "bg-primary/5")}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge variant={n.priority === "critical" ? "destructive" : "secondary"} className="text-[10px]">{n.priority}</Badge>
                <Badge variant="outline" className="text-[10px]">{n.module}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="font-medium">{n.title}</div>
              <div className="text-sm text-muted-foreground">{n.message}</div>
            </div>
            <div className="flex gap-1">
              {!n.is_read && (
                <Button variant="ghost" size="icon" onClick={() => markRead(n.id).then(load)} aria-label="Mark read">
                  <CheckCheck className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => softDelete(n.id).then(load)} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}