import { useEffect, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { refreshModuleFlags } from "@/hooks/useModuleFlags";

const SystemSettings = () => {
  const [s, setS] = useState({ app_name: "", currency: "USD", default_trial_days: 15, customers_module_enabled: false });
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const REQUIRED = "I understand this will permanently delete data";

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("system_settings").select("*").eq("id", 1).maybeSingle();
      if (data) setS({
        app_name: data.app_name,
        currency: data.currency,
        default_trial_days: data.default_trial_days,
        customers_module_enabled: !!(data as any).customers_module_enabled,
      });
    })();
  }, []);
  const save = async () => {
    const { error } = await supabase.from("system_settings").update({
      app_name: s.app_name, currency: s.currency, default_trial_days: Number(s.default_trial_days),
      customers_module_enabled: s.customers_module_enabled,
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    await refreshModuleFlags();
    toast.success("Saved");
  };

  const downloadJson = (name: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const callReset = async (action: "backup") => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-data", {
        body: { action, confirm: confirmPhrase },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      if ((data as any)?.backup) {
        downloadJson(`backup-${action}-${Date.now()}.json`, (data as any).backup);
      }
      toast.success((data as any)?.message ?? "Done");
      setConfirmPhrase("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (file: File) => {
    if (confirmPhrase !== REQUIRED) return toast.error(`Type exactly: ${REQUIRED}`);
    setBusy("restore");
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const { data, error } = await supabase.functions.invoke("admin-reset-data", {
        body: { action: "restore", backup, confirm: confirmPhrase },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Backup restored");
      setConfirmPhrase("");
    } catch (e: any) {
      toast.error(e.message ?? "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 text-zinc-100">
      <h1 className="text-2xl font-bold">System Settings</h1>
      <Card className="bg-zinc-900 border-zinc-800 max-w-lg">
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>App Name</Label><Input value={s.app_name} onChange={e => setS({ ...s, app_name: e.target.value })}/></div>
          <div><Label>Currency</Label><Input value={s.currency} onChange={e => setS({ ...s, currency: e.target.value })}/></div>
          <div><Label>Default Trial Days</Label><Input type="number" value={s.default_trial_days} onChange={e => setS({ ...s, default_trial_days: Number(e.target.value) })}/></div>
          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div>
              <Label className="text-zinc-100">Enable Customers Module</Label>
              <p className="text-xs text-zinc-500 mt-1">Hides Customers menu, POS selector and dashboard widget when off. Existing data is preserved.</p>
            </div>
            <Switch checked={s.customers_module_enabled} onCheckedChange={(v) => setS({ ...s, customers_module_enabled: v })} />
          </div>
          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800 max-w-2xl">
        <CardHeader><CardTitle>Global Backup & Restore</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-300">
          <p className="text-xs text-zinc-400">
            Per-client reset actions (Business Reset, Factory Reset, Delete Client) now live on the
            <b className="text-zinc-200"> Clients</b> page — each with its own confirmation flow and auto-backup.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" disabled={busy !== null}
              onClick={() => callReset("backup")}
              className="border-zinc-700 hover:bg-zinc-800">
              <Download className="h-4 w-4" /> Download Global Backup (JSON)
            </Button>
            <label className="inline-flex">
              <input type="file" accept="application/json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRestore(f); e.currentTarget.value = ""; }} />
              <span className={`inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                <Upload className="h-4 w-4" /> Restore From Backup
              </span>
            </label>
          </div>
          <div>
            <Label className="text-zinc-200">Type to confirm restore</Label>
            <Input value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={REQUIRED} className="bg-zinc-950 border-zinc-700" />
            <p className="mt-1 text-xs text-zinc-500">Only required for Restore.</p>
          </div>
          {busy && <p className="text-xs text-zinc-400">Working… ({busy})</p>}
        </CardContent>
      </Card>
    </div>
  );
};
export default SystemSettings;