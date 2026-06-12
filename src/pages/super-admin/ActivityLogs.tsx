import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

const ActivityLogs = () => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200);
      setRows(data ?? []);
    })();
  }, []);
  return (
    <div className="space-y-4 text-zinc-100">
      <h1 className="text-2xl font-bold">Activity Logs</h1>
      <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/50 text-zinc-400 text-left">
            <tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Entity</th><th className="p-3">Tenant</th><th className="p-3">Metadata</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="p-3 text-zinc-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-3 font-mono text-xs">{r.action}</td>
                <td className="p-3">{r.entity ?? "—"}</td>
                <td className="p-3 font-mono text-xs">{r.tenant_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-3 text-zinc-400 text-xs"><pre className="whitespace-pre-wrap">{JSON.stringify(r.metadata, null, 0)}</pre></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-zinc-500">No activity yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
export default ActivityLogs;