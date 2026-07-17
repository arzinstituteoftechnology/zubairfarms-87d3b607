import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { SeoHead } from "@/components/SeoHead";
import { isValidPkPhone, normalizePkPhone, maskPhone } from "@/lib/phone";
import { format } from "date-fns";
import { Download, Send, RefreshCw } from "lucide-react";

type Settings = {
  id?: string; tenant_id: string;
  provider: string; sender_id: string | null;
  admin_phone: string | null; country_code: string;
  is_enabled: boolean; notify_admin: boolean; notify_customer: boolean;
  admin_notification_types: string[]; customer_notification_types: string[];
  quiet_hours_enabled: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null;
};

type Template = {
  id: string; tenant_id: string;
  event_type: string; recipient_type: string;
  template_name: string; message_body: string;
  language: string; is_active: boolean;
};

type QueueRow = {
  id: string; created_at: string; event_type: string; recipient_type: string;
  recipient_name: string | null; phone_number: string; status: string;
  attempt_count: number; error_message: string | null; provider_message_id: string | null;
};

type LogRow = {
  id: string; created_at: string; event_type: string; status: string;
  phone_number_masked: string; provider_message_id: string | null; error_message: string | null;
};

const emptySettings = (tid: string): Settings => ({
  tenant_id: tid, provider: "gatewayapi", sender_id: "MeatFlow",
  admin_phone: "", country_code: "+92",
  is_enabled: false, notify_admin: true, notify_customer: true,
  admin_notification_types: [], customer_notification_types: [],
  quiet_hours_enabled: false, quiet_hours_start: null, quiet_hours_end: null,
});

const SmsNotifications = () => {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? "";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("MeatFlow test SMS ✓");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    const { data } = await supabase.rpc("ensure_sms_settings" as any, { _tenant_id: tenantId });
    setSettings((data as any) ?? emptySettings(tenantId));
    const { data: tpls } = await supabase.from("sms_templates" as any).select("*")
      .eq("tenant_id", tenantId).order("event_type").order("recipient_type");
    setTemplates((tpls as any) ?? []);
    const { data: q } = await supabase.from("sms_queue" as any).select("*")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
    setQueue((q as any) ?? []);
    const { data: l } = await supabase.from("sms_delivery_logs" as any).select("*")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
    setLogs((l as any) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const save = async () => {
    if (!settings || !tenantId) return;
    if (settings.admin_phone && !isValidPkPhone(settings.admin_phone)) {
      return toast.error("Enter a valid mobile number such as 03001234567.");
    }
    setSaving(true);
    const payload = {
      ...settings,
      admin_phone: settings.admin_phone ? normalizePkPhone(settings.admin_phone) : null,
    };
    const { error } = await supabase.from("sms_settings" as any).upsert(payload, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("SMS settings saved");
    load();
  };

  const saveTemplate = async (t: Template) => {
    const { error } = await supabase.from("sms_templates" as any)
      .update({ template_name: t.template_name, message_body: t.message_body, is_active: t.is_active })
      .eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("Template saved");
  };

  const sendTest = async () => {
    if (!isValidPkPhone(testPhone)) return toast.error("Enter a valid mobile number.");
    const { data, error } = await supabase.functions.invoke("send-sms", {
      body: {
        tenant_id: tenantId,
        phone_number: testPhone,
        message_body: testMsg,
        event_type: "test_message",
        recipient_type: "admin",
      },
    });
    if (error) return toast.error(error.message);
    if ((data as any)?.ok) toast.success("Test SMS dispatched.");
    else toast.error((data as any)?.error ?? "Test send failed.");
    load();
  };

  const retry = async (row: QueueRow) => {
    const { error } = await supabase.from("sms_queue" as any).update({ status: "pending" }).eq("id", row.id);
    if (error) return toast.error(error.message);
    await supabase.functions.invoke("send-sms", { body: { queue_id: row.id } });
    toast.success("Retry queued.");
    load();
  };

  const exportLogs = () => {
    const rows = filteredLogs;
    const header = ["Date", "Event", "Status", "Phone (masked)", "Provider Msg ID", "Error"];
    const body = rows.map(r => [
      r.created_at, r.event_type, r.status, r.phone_number_masked,
      r.provider_message_id ?? "", r.error_message ?? "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `sms-logs-${format(new Date(), "yyyyMMdd-HHmm")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = useMemo(() => logs.filter(l => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (search && ![l.event_type, l.status, l.phone_number_masked, l.provider_message_id ?? ""].join(" ").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [logs, statusFilter, search]);

  if (!settings) return <div className="p-6 text-muted-foreground">Loading SMS settings…</div>;

  return (
    <>
      <SeoHead title="SMS Notifications | MeatFlow" description="Configure the enterprise SMS notification system." />
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">SMS Notifications</h1>
          <p className="text-sm text-muted-foreground">Provider, templates, delivery logs, and test sends.</p>
        </div>

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="logs">Delivery Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Provider &amp; Recipients</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Provider</Label>
                  <Select value={settings.provider} onValueChange={v => setSettings({ ...settings, provider: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gatewayapi">GatewayAPI</SelectItem>
                      <SelectItem value="twilio">Twilio</SelectItem>
                      <SelectItem value="generic_http">Generic HTTP</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Provider is selected here for display. The active provider secrets are stored server-side.
                  </p>
                </div>
                <div>
                  <Label>Sender ID</Label>
                  <Input value={settings.sender_id ?? ""} onChange={e => setSettings({ ...settings, sender_id: e.target.value })} placeholder="MeatFlow" />
                </div>
                <div>
                  <Label>Admin Mobile</Label>
                  <Input value={settings.admin_phone ?? ""} onChange={e => setSettings({ ...settings, admin_phone: e.target.value })} placeholder="03001234567" />
                  <p className="text-xs text-muted-foreground mt-1">Enter a valid mobile number such as 03001234567.</p>
                </div>
                <div>
                  <Label>Country Code</Label>
                  <Input value={settings.country_code} onChange={e => setSettings({ ...settings, country_code: e.target.value })} />
                </div>
                <div className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <Label>Enable SMS</Label>
                    <p className="text-xs text-muted-foreground">Master switch for all outbound SMS.</p>
                  </div>
                  <Switch checked={settings.is_enabled} onCheckedChange={v => setSettings({ ...settings, is_enabled: v })} />
                </div>
                <div className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <Label>Notify Admin</Label>
                    <p className="text-xs text-muted-foreground">Send admin summaries.</p>
                  </div>
                  <Switch checked={settings.notify_admin} onCheckedChange={v => setSettings({ ...settings, notify_admin: v })} />
                </div>
                <div className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <Label>Notify Customer / Shop / Farm</Label>
                    <p className="text-xs text-muted-foreground">Send transactional SMS to affected parties.</p>
                  </div>
                  <Switch checked={settings.notify_customer} onCheckedChange={v => setSettings({ ...settings, notify_customer: v })} />
                </div>
                <div className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <Label>Quiet Hours</Label>
                    <p className="text-xs text-muted-foreground">Hold non-critical SMS during set hours.</p>
                  </div>
                  <Switch checked={settings.quiet_hours_enabled} onCheckedChange={v => setSettings({ ...settings, quiet_hours_enabled: v })} />
                </div>
                {settings.quiet_hours_enabled && <>
                  <div><Label>Quiet From</Label><Input type="time" value={settings.quiet_hours_start ?? ""} onChange={e => setSettings({ ...settings, quiet_hours_start: e.target.value })} /></div>
                  <div><Label>Quiet To</Label><Input type="time" value={settings.quiet_hours_end ?? ""} onChange={e => setSettings({ ...settings, quiet_hours_end: e.target.value })} /></div>
                </>}
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Settings"}</Button>
              <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</Button>
            </div>

            <Card>
              <CardHeader><CardTitle>Send Test SMS</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[1fr,2fr,auto] items-end">
                <div>
                  <Label>Phone</Label>
                  <Input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="03001234567" />
                </div>
                <div>
                  <Label>Message</Label>
                  <Input value={testMsg} onChange={e => setTestMsg(e.target.value)} />
                </div>
                <Button onClick={sendTest}><Send className="h-4 w-4" /> Send Test</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="space-y-3">
            {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates yet. Save settings once to seed defaults.</p>}
            {templates.map((t, i) => (
              <Card key={t.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                  <div>
                    <CardTitle className="text-base">{t.template_name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Event: <code>{t.event_type}</code> · Recipient: <code>{t.recipient_type}</code> · Lang: {t.language}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Active</Label>
                    <Switch checked={t.is_active} onCheckedChange={v => {
                      const copy = [...templates]; copy[i] = { ...t, is_active: v }; setTemplates(copy);
                    }} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Textarea rows={3} value={t.message_body} onChange={e => {
                    const copy = [...templates]; copy[i] = { ...t, message_body: e.target.value }; setTemplates(copy);
                  }} />
                  <Button size="sm" onClick={() => saveTemplate(templates[i])}>Save Template</Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="queue" className="space-y-3">
            <div className="text-sm text-muted-foreground">Last 100 queued messages.</div>
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>
                  <th className="text-left p-2">Date</th><th className="text-left p-2">Event</th>
                  <th className="text-left p-2">Recipient</th><th className="text-left p-2">Phone</th>
                  <th className="text-left p-2">Status</th><th className="text-left p-2">Attempts</th>
                  <th className="text-left p-2">Error</th><th className="text-right p-2">Action</th>
                </tr></thead>
                <tbody>
                  {queue.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="p-2"><code>{r.event_type}</code></td>
                      <td className="p-2">{r.recipient_type}{r.recipient_name ? ` · ${r.recipient_name}` : ""}</td>
                      <td className="p-2">{maskPhone(r.phone_number)}</td>
                      <td className="p-2">{r.status}</td>
                      <td className="p-2">{r.attempt_count}</td>
                      <td className="p-2 max-w-xs truncate" title={r.error_message ?? ""}>{r.error_message ?? "—"}</td>
                      <td className="p-2 text-right">
                        {r.status === "failed" && <Button size="sm" variant="outline" onClick={() => retry(r)}>Retry</Button>}
                      </td>
                    </tr>
                  ))}
                  {queue.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No messages yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="logs" className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="skipped">Skipped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[220px]">
                <Label>Search</Label>
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Event, provider msg id, phone…" />
              </div>
              <Button variant="outline" onClick={exportLogs}><Download className="h-4 w-4" /> Export CSV</Button>
            </div>
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>
                  <th className="text-left p-2">Date</th><th className="text-left p-2">Event</th>
                  <th className="text-left p-2">Status</th><th className="text-left p-2">Phone</th>
                  <th className="text-left p-2">Provider Msg ID</th><th className="text-left p-2">Error</th>
                </tr></thead>
                <tbody>
                  {filteredLogs.map(l => (
                    <tr key={l.id} className="border-t">
                      <td className="p-2">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="p-2"><code>{l.event_type}</code></td>
                      <td className="p-2">{l.status}</td>
                      <td className="p-2">{l.phone_number_masked}</td>
                      <td className="p-2">{l.provider_message_id ?? "—"}</td>
                      <td className="p-2 max-w-xs truncate" title={l.error_message ?? ""}>{l.error_message ?? "—"}</td>
                    </tr>
                  ))}
                  {filteredLogs.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No logs match.</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default SmsNotifications;