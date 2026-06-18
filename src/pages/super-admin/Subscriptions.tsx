import { useEffect, useState } from "react";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { Card } from "@/components/ui/card";

const Subscriptions = () => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, started_at, expires_at, status, tenants(company_name), subscription_plans(name, billing_cycle)")
        .order("expires_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, []);
  return (
    <div className="space-y-4 text-zinc-100">
      <h1 className="text-2xl font-bold">Subscriptions</h1>
      <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm text-zinc-100">
          <thead className="bg-zinc-800/50 text-zinc-100 text-left">
            <tr><th className="p-3">Client</th><th className="p-3">Plan</th><th className="p-3">Started</th><th className="p-3">Expires</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const expired = new Date(r.expires_at) < new Date();
              return (
                <tr key={r.id} className="border-t border-zinc-800">
                  <td className="p-3">{r.tenants?.company_name ?? "—"}</td>
                  <td className="p-3">{r.subscription_plans?.name ?? "—"}</td>
                  <td className="p-3 text-zinc-300">{new Date(r.started_at).toLocaleDateString()}</td>
                  <td className="p-3 text-zinc-300">{new Date(r.expires_at).toLocaleDateString()}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs ${expired ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>{expired ? "expired" : r.status}</span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-zinc-300">No subscriptions yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
export default Subscriptions;