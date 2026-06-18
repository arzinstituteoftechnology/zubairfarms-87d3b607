import { useEffect, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Mail, Save, BellRing } from "lucide-react";

type Settings = {
  primary_email: string | null;
  secondary_email: string | null;
  email_enabled: boolean;
};

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const BackupEmailSettings = () => {
  const [s, setS] = useState<Settings>({ primary_email: "", secondary_email: "", email_enabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("backup_settings")
        .select("primary_email, secondary_email, email_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (error) toast.error(error.message);
      if (data) setS({
        primary_email: data.primary_email ?? "",
        secondary_email: data.secondary_email ?? "",
        email_enabled: !!data.email_enabled,
      });
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    const primary = (s.primary_email ?? "").trim();
    const secondary = (s.secondary_email ?? "").trim();
    if (s.email_enabled && !primary) return toast.error("Primary email is required when notifications are enabled");
    if (primary && !isValidEmail(primary)) return toast.error("Primary email is not a valid address");
    if (secondary && !isValidEmail(secondary)) return toast.error("Secondary email is not a valid address");

    setSaving(true);
    const { error } = await supabase
      .from("backup_settings")
      .update({
        primary_email: primary || null,
        secondary_email: secondary || null,
        email_enabled: s.email_enabled,
      })
      .eq("id", 1);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Backup email settings saved");
  };

  return (
    <div className="space-y-6 text-zinc-100">
      <div>
        <h1 className="text-2xl font-bold">Backup Email Settings</h1>
        <p className="text-zinc-400 text-sm">Configure recipients for daily backup notifications and failure alerts.</p>
      </div>

      <Card className="bg-zinc-900 border-zinc-800 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Notification Recipients
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-start gap-3">
              <BellRing className="h-4 w-4 mt-0.5 text-zinc-400" />
              <div>
                <div className="font-medium">Enable email notifications</div>
                <div className="text-xs text-zinc-500">Send backup success and failure reports to the recipients below.</div>
              </div>
            </div>
            <Switch
              checked={s.email_enabled}
              onCheckedChange={(v) => setS((p) => ({ ...p, email_enabled: v }))}
              disabled={loading}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-zinc-300">Primary Email</Label>
              <Input
                type="email"
                className="bg-zinc-950 border-zinc-700"
                placeholder="admin@example.com"
                value={s.primary_email ?? ""}
                disabled={loading}
                onChange={(e) => setS((p) => ({ ...p, primary_email: e.target.value }))}
              />
              <p className="text-xs text-zinc-500 mt-1">Main recipient for all backup notifications.</p>
            </div>
            <div>
              <Label className="text-zinc-300">Secondary Email</Label>
              <Input
                type="email"
                className="bg-zinc-950 border-zinc-700"
                placeholder="ops@example.com (optional)"
                value={s.secondary_email ?? ""}
                disabled={loading}
                onChange={(e) => setS((p) => ({ ...p, secondary_email: e.target.value }))}
              />
              <p className="text-xs text-zinc-500 mt-1">Optional backup/cc recipient.</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={save} disabled={loading || saving}>
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BackupEmailSettings;