import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const SystemSettings = () => {
  const [s, setS] = useState({ app_name: "", currency: "USD", default_trial_days: 15 });
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("system_settings").select("*").eq("id", 1).maybeSingle();
      if (data) setS({ app_name: data.app_name, currency: data.currency, default_trial_days: data.default_trial_days });
    })();
  }, []);
  const save = async () => {
    const { error } = await supabase.from("system_settings").update({
      app_name: s.app_name, currency: s.currency, default_trial_days: Number(s.default_trial_days),
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Saved");
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
          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
};
export default SystemSettings;