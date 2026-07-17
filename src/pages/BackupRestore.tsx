import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, Trash2, ShieldAlert, RotateCcw, Play, ShieldCheck, Loader2 } from "lucide-react";
import { RestoreWizard } from "@/components/backup/RestoreWizard";
import { nextRunAt, formatSize, SCHEDULE_LABELS, type BackupSchedule } from "@/lib/backupSchedule";

type Backup = {
  id: string; backup_name: string | null; created_at: string; completed_at: string | null;
  file_size: number | null; backup_type: string; status: string;
  error_message: string | null; created_by: string | null;
  checksum_sha256: string | null; schema_version: string | null;
  table_counts: Record<string, number> | null;
};

type Settings = {
  tenant_id: string; schedule: BackupSchedule; retain_backups: number;
  next_run_at: string | null; last_run_at: string | null;
};

export default function BackupRestore() {
  const { tenant } = useAuth();
  const { isOwner } = usePermissions();
  const [rows, setRows] = useState<Backup[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all"|"success"|"failed"|"pending">("all");

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const [{ data: hist }, { data: st }] = await Promise.all([
      (supabase as any).from("backup_history")
        .select("id, backup_name, created_at, completed_at, file_size, backup_type, status, error_message, created_by, checksum_sha256, schema_version, table_counts")
        .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
      (supabase as any).from("tenant_backup_settings").select("*").eq("tenant_id", tenant.id).maybeSingle(),
    ]);
    setRows((hist as Backup[]) ?? []);
    setSettings((st as Settings) ?? null);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter),
    [rows, statusFilter],
  );

  const last = rows[0] ?? null;
  const totalSize = rows.reduce((a, r) => a + (r.file_size ?? 0), 0);

  const createBackup = async () => {
    if (!tenant?.id) return;
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("system-backup", {
      body: { action: "create", backup_type: "manual", tenant_id: tenant.id },
    });
    setCreating(false);
    if (error || data?.error) {
      toast.error(error?.message ?? data?.error ?? "Backup failed");
    } else {
      toast.success("Backup created");
      load();
    }
  };

  const downloadBackup = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("system-backup", { body: { action: "download", backup_id: id } });
    if (error || !data?.url) return toast.error(error?.message ?? "Download failed");
    window.open(data.url, "_blank");
  };

  const deleteBackup = async (id: string) => {
    if (!confirm("Delete this backup permanently? This cannot be undone.")) return;
    const { error } = await (supabase as any).rpc("delete_backup", { _id: id, _reason: "Owner deletion via Backup Center" });
    if (error) toast.error(error.message);
    else { toast.success("Backup deleted"); load(); }
  };

  const saveSettings = async (schedule: BackupSchedule, retain: number) => {
    if (!tenant?.id) return;
    const next = nextRunAt(schedule);
    const { error } = await (supabase as any).from("tenant_backup_settings").upsert({
      tenant_id: tenant.id,
      schedule,
      retain_backups: retain,
      next_run_at: next ? next.toISOString() : null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Schedule saved"); load(); }
  };

  if (!isOwner) {
    return (
      <Card className="p-8 text-center">
        <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
        <div className="font-semibold">Owner access required</div>
        <div className="text-sm text-muted-foreground">Only the account Owner can manage Backup & Restore.</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Backup & Restore</h1>
          <p className="text-sm text-muted-foreground">Snapshot, verify, and restore every table in your account.</p>
        </div>
        <Button onClick={createBackup} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          Create backup now
        </Button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Last Backup</div>
          <div className="text-sm font-semibold mt-1">{last ? new Date(last.created_at).toLocaleString() : "—"}</div>
          <div className="text-xs text-muted-foreground">{last?.backup_name ?? "No backups yet"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Next Scheduled</div>
          <div className="text-sm font-semibold mt-1">{settings?.next_run_at ? new Date(settings.next_run_at).toLocaleString() : "—"}</div>
          <div className="text-xs text-muted-foreground">{settings ? SCHEDULE_LABELS[settings.schedule] : "Off"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Total Size</div>
          <div className="text-sm font-semibold mt-1">{formatSize(totalSize)}</div>
          <div className="text-xs text-muted-foreground">{rows.length} backups · retention {settings?.retain_backups ?? 30}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Encryption</div>
          <div className="text-sm font-semibold mt-1 flex items-center gap-1"><ShieldCheck className="h-4 w-4 text-green-600" /> Enabled</div>
          <div className="text-xs text-muted-foreground">Gzip + storage AES · SHA-256 checksum</div>
        </Card>
      </div>

      {/* Scheduler */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Automatic backup schedule</Label>
            <Select
              value={settings?.schedule ?? "off"}
              onValueChange={(v) => saveSettings(v as BackupSchedule, settings?.retain_backups ?? 30)}
            >
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SCHEDULE_LABELS) as BackupSchedule[]).map((k) => (
                  <SelectItem key={k} value={k}>{SCHEDULE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Retention (backups to keep)</Label>
            <Input
              type="number" min={1} max={365}
              className="w-32"
              defaultValue={settings?.retain_backups ?? 30}
              onBlur={(e) => {
                const v = Math.max(1, Math.min(365, Number(e.target.value) || 30));
                saveSettings(settings?.schedule ?? "off", v);
              }}
            />
          </div>
          <div className="ml-auto">
            <Button variant="outline" onClick={() => setWizardOpen(true)} disabled={rows.length === 0}>
              <RotateCcw className="h-4 w-4 mr-1" /> Restore backup
            </Button>
          </div>
        </div>
      </Card>

      {/* History */}
      <Card>
        <div className="p-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Backup History</div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Checksum</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No backups match this filter.</TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.backup_name ?? r.id.slice(0,8)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{formatSize(r.file_size)}</TableCell>
                  <TableCell className="text-xs">{r.backup_type === "manual" ? "Manual" : "Automatic"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "success" ? "secondary" : r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{r.checksum_sha256?.slice(0,12) ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => downloadBackup(r.id)} disabled={r.status !== "success"} aria-label="Download">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteBackup(r.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <RestoreWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        backups={rows.filter((r) => r.status === "success") as any}
        onDone={load}
      />
    </div>
  );
}