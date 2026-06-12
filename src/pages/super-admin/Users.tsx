import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

const Users = () => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tenant_users")
        .select("id, tenant_role, created_at, user_id, tenants(company_name)")
        .order("created_at", { ascending: false });
      const list = data ?? [];
      // hydrate profile names
      const ids = Array.from(new Set(list.map((r: any) => r.user_id)));
      const { data: profs } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] as any[] };
      const pmap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      setRows(list.map((r: any) => ({ ...r, full_name: pmap.get(r.user_id) ?? r.user_id.slice(0, 8) })));
    })();
  }, []);
  return (
    <div className="space-y-4 text-zinc-100">
      <h1 className="text-2xl font-bold">Users</h1>
      <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/50 text-zinc-400 text-left">
            <tr><th className="p-3">User</th><th className="p-3">Tenant</th><th className="p-3">Role</th><th className="p-3">Added</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="p-3">{r.full_name}</td>
                <td className="p-3">{r.tenants?.company_name ?? "—"}</td>
                <td className="p-3">{r.tenant_role}</td>
                <td className="p-3 text-zinc-400">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="p-6 text-center text-zinc-500">No users yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
export default Users;