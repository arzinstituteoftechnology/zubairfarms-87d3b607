import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const Settings = () => {
  const { role } = useAuth();
  const [thr, setThr] = useState("2");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("settings").select("wastage_threshold_pct").eq("id", 1).maybeSingle()
      .then(({ data }) => { if (data) setThr(String(data.wastage_threshold_pct)); });
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("settings").update({ wastage_threshold_pct: Number(thr) }).eq("id", 1);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Settings saved");
  };

  if (role !== "admin") return <div className="text-muted-foreground">Admin access required.</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">App-wide configuration</p>
      </div>
      <Card className="max-w-md">
        <CardHeader><CardTitle>Wastage threshold</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Excess wastage threshold (%)</Label>
            <Input type="number" step="0.01" min="0" value={thr} onChange={(e) => setThr(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Daily / per-batch wastage above this percentage is flagged as excess.</p>
          </div>
          <Button onClick={save} disabled={saving}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
};
export default Settings;