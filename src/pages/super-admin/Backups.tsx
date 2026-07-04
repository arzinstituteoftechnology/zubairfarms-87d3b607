import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Database, Download, HardDrive, Mail, RefreshCw, RotateCw, Save, ShieldCheck, Trash2, Upload, Cloud } from "lucide-react";

type BackupRow = {
  id: string;
  backup_type: string;
  status: string;
  storage_path: string | null;
  file_size: number | null;
  table_counts: Record<string, number> | null;
  health: any;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  backup_name: string | null;
};

type Settings = {
  id: number;
  primary_email: string | null;
  secondary_email: string | null;
  email_enabled: boolean;
  drive_enabled: boolean;
  drive_folder_id: string | null;
  drive_last_upload_at: string | null;
  drive_last_status: string | null;
  retain_daily: number;
  retain_monthly: number;
  retain_manual: number;
};

const formatBytes = (n: number | null) => {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

const statusBadge = (s: string) => {
  const color =
    s === "success" ? "bg-emerald-600" :
    s === "warning" ? "bg-amber-600" :
    s === "failed" ? "bg-red-600" :
    "bg-zinc-600";
  return <Badge className={`${color} text-white border-0`}>{s}</Badge>;
};

const Backups = () => {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: hist }, { data: cfg }] = await Promise.all([
      supabase.from("backup_history").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("backup_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    setRows((hist ?? []) as BackupRow[]);
    setSettings(cfg as Settings | null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const last = rows[0];

  const invoke = async (action: string, payload: any = {}) => {
    setWorking(action);
    try {
      const { data, error } = await supabase.functions.invoke("system-backup", { body: { action, ...payload } });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    } finally { setWorking(null); }
  };

  const runBackup = async (backup_type: "manual" | "daily" = "manual") => {
    try {
      const res: any = await invoke("create", { backup_type });
      toast.success(`Backup created (${formatBytes(res.size)})`);
      load();
    } catch (e: any) { toast.error(e.message ?? "Backup failed"); }
  };

  const downloadBackup = async (id: string) => {
    try {
      const res: any = await invoke("download", { backup_id: id });
      const a = document.createElement("a");
      a.href = res.url; a.download = res.filename; a.target = "_blank";
      a.click();
    } catch (e: any) { toast.error(e.message ?? "Download failed"); }
  };

  const deleteBackup = async (id: string, path: string | null) => {
    if (path) await supabase.storage.from("system-backups").remove([path]).catch(() => {});
    const { error } = await supabase.from("backup_history").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Backup deleted");
    load();
  };

  const restoreFromHistory = async (id: string) => {
    try {
      const res: any = await invoke("restore", { backup_id: id });
      toast.success(`Restore complete. Emergency backup id: ${res.pre_restore_backup_id?.slice(0, 8)}…`);
      load();
    } catch (e: any) { toast.error(e.message ?? "Restore failed"); }
  };

  const restoreFromFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res: any = await invoke("restore", { backup: parsed });
      toast.success(`Restore from file complete.`);
      load();
    } catch (e: any) { toast.error(e.message ?? "Restore failed"); }
  };

  const runCleanup = async () => {
    try {
      const res: any = await invoke("cleanup");
      toast.success(`Cleanup done — ${res.deleted} old backups removed`);
      load();
    } catch (e: any) { toast.error(e.message ?? "Cleanup failed"); }
  };

  const saveSettings = async () => {
    if (!settings) return;
    const { error } = await supabase.from("backup_settings").update({
      primary_email: settings.primary_email,
      secondary_email: settings.secondary_email,
      email_enabled: settings.email_enabled,
      drive_enabled: settings.drive_enabled,
      drive_folder_id: settings.drive_folder_id,
      retain_daily: settings.retain_daily,
      retain_monthly: settings.retain_monthly,
      retain_manual: settings.retain_manual,
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  };

  const healthBadge = useMemo(() => {
    if (!last) return <Badge className="bg-zinc-600 text-white border-0">No backups</Badge>;
    if (last.status === "success") return <Badge className="bg-emerald-600 text-white border-0">Healthy</Badge>;
    if (last.status === "warning") return <Badge className="bg-amber-600 text-white border-0">Warning</Badge>;
    return <Badge className="bg-red-600 text-white border-0">Failed</Badge>;
  }, [last]);

  return (
    <div className="space-y-6 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Enterprise Backups</h1>
          <p className="text-zinc-400 text-sm">Daily auto-backups, manual snapshots, restore & retention</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-zinc-700 hover:bg-zinc-800" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button onClick={() => runBackup("manual")} disabled={!!working}>
            <Save className="h-4 w-4" /> Create Backup Now
          </Button>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Last Backup</CardTitle>
            <Database className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{last ? new Date(last.created_at).toLocaleString() : "—"}</div>
            <div className="text-xs text-zinc-500 mt-1">{last ? `${formatBytes(last.file_size)} · ${last.backup_type}` : "No backups yet"}</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Backup Status</CardTitle>
            <ShieldCheck className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            <div>{healthBadge}</div>
            <div className="text-xs text-zinc-500 mt-1">
              {last?.health?.total_records != null ? `${last.health.total_records} records` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Google Drive</CardTitle>
            <Cloud className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{settings?.drive_enabled ? "Enabled" : "Disabled"}</div>
            <div className="text-xs text-zinc-500 mt-1">{settings?.drive_last_upload_at ? `Last: ${new Date(settings.drive_last_upload_at).toLocaleString()}` : "Not connected"}</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Next Scheduled</CardTitle>
            <HardDrive className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">Daily 23:59 UTC</div>
            <div className="text-xs text-zinc-500 mt-1">Retention: {settings?.retain_daily ?? 30} daily / {settings?.retain_monthly ?? 12} monthly / {settings?.retain_manual ?? 5} manual</div>
          </CardContent>
        </Card>
      </div>

      {/* Restore from file */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Restore From File</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3 text-sm text-zinc-400">
          <input ref={fileRef} type="file" accept="application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreFromFile(f); if (fileRef.current) fileRef.current.value = ""; }} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="border-zinc-700 hover:bg-zinc-800" disabled={!!working}>
                <Upload className="h-4 w-4" /> Choose JSON file…
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Restore from local backup file?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">
                  An <b className="text-zinc-200">emergency backup</b> of the current database will be created first. Existing rows with matching IDs will be overwritten. Super admin accounts are always preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-zinc-800 border-zinc-700">Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => fileRef.current?.click()}>I understand, choose file</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <span>Pick a JSON backup downloaded from this system.</span>
        </CardContent>
      </Card>

      {/* History */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Backup History</CardTitle>
          <Button variant="ghost" size="sm" className="text-zinc-300 hover:bg-zinc-800" onClick={runCleanup} disabled={!!working}>
            <Trash2 className="h-4 w-4" /> Run retention cleanup
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-100">When</TableHead>
                <TableHead className="text-zinc-100">Tenant</TableHead>
                <TableHead className="text-zinc-100">Backup Name</TableHead>
                <TableHead className="text-zinc-100">Type</TableHead>
                <TableHead className="text-zinc-100">Status</TableHead>
                <TableHead className="text-zinc-100">Size</TableHead>
                <TableHead className="text-zinc-100">Records</TableHead>
                <TableHead className="text-zinc-100 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-zinc-300 py-8">No backups yet</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="border-zinc-800 hover:bg-zinc-800/40">
                  <TableCell className="font-mono text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.tenant_name ?? <span className="text-zinc-500">System-wide</span>}</TableCell>
                  <TableCell className="font-mono text-[11px] text-zinc-300 truncate max-w-xs" title={r.backup_name ?? ""}>{r.backup_name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{r.backup_type.replace("_", " ")}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell>{formatBytes(r.file_size)}</TableCell>
                  <TableCell>{r.health?.total_records ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="ghost" className="text-zinc-300 hover:bg-zinc-700"
                      onClick={() => downloadBackup(r.id)} disabled={!r.storage_path}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-amber-400 hover:bg-amber-950" disabled={!r.storage_path || !!working}>
                          <RotateCw className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
                          <AlertDialogDescription className="text-zinc-400">
                            An <b className="text-zinc-200">emergency backup</b> of the current data will be created first. Existing rows with matching IDs will be overwritten. Super admin accounts are preserved.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-zinc-800 border-zinc-700">Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-amber-600 hover:bg-amber-700" onClick={() => restoreFromHistory(r.id)}>Restore</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-950">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
                          <AlertDialogDescription className="text-zinc-400">The backup file and history record will be permanently removed.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-zinc-800 border-zinc-700">Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteBackup(r.id, r.storage_path)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Settings */}
      {settings && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" /> Backup Settings</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 max-w-3xl">
            <div>
              <Label className="text-zinc-300">Primary Email</Label>
              <Input className="bg-zinc-950 border-zinc-700" value={settings.primary_email ?? ""} onChange={e => setSettings({ ...settings, primary_email: e.target.value })} placeholder="admin@example.com" />
            </div>
            <div>
              <Label className="text-zinc-300">Secondary Email</Label>
              <Input className="bg-zinc-950 border-zinc-700" value={settings.secondary_email ?? ""} onChange={e => setSettings({ ...settings, secondary_email: e.target.value })} placeholder="optional@example.com" />
            </div>
            <div>
              <Label className="text-zinc-300">Retain Daily</Label>
              <Input type="number" min={1} className="bg-zinc-950 border-zinc-700" value={settings.retain_daily} onChange={e => setSettings({ ...settings, retain_daily: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-zinc-300">Retain Monthly</Label>
              <Input type="number" min={1} className="bg-zinc-950 border-zinc-700" value={settings.retain_monthly} onChange={e => setSettings({ ...settings, retain_monthly: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-zinc-300">Retain Manual</Label>
              <Input type="number" min={1} className="bg-zinc-950 border-zinc-700" value={settings.retain_manual} onChange={e => setSettings({ ...settings, retain_manual: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-zinc-300">Google Drive Folder ID</Label>
              <Input className="bg-zinc-950 border-zinc-700" value={settings.drive_folder_id ?? ""} onChange={e => setSettings({ ...settings, drive_folder_id: e.target.value })} placeholder="Drive folder ID (optional)" />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between text-xs text-zinc-500">
              <span>Email & Google Drive delivery hooks are scaffolded; connect an email provider and Drive connector to enable automatic upload.</span>
              <Button onClick={saveSettings}><Save className="h-4 w-4" /> Save Settings</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Backups;