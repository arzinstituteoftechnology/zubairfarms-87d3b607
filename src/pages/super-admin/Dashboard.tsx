import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, CheckCircle2, AlertOctagon, PauseCircle, DollarSign, TrendingUp, Tractor, Users, Database } from "lucide-react";

interface Stat { label: string; value: string | number; icon: any; color: string }

const Dashboard = () => {
  const [stats, setStats] = useState<Stat[]>([]);
  const [lastBackup, setLastBackup] = useState<{ created_at: string; status: string; backup_type: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: tenants }, { data: subs }, { data: payments }, { data: farms }, { data: tu }] = await Promise.all([
        supabase.from("tenants").select("id, status"),
        supabase.from("subscriptions").select("status, expires_at"),
        supabase.from("payments").select("amount, payment_date, status"),
        supabase.from("farms").select("id"),
        supabase.from("tenant_users").select("user_id"),
      ]);
      const total = tenants?.length ?? 0;
      const active = (subs ?? []).filter(s => new Date(s.expires_at) > new Date() && s.status !== "suspended").length;
      const expired = (subs ?? []).filter(s => new Date(s.expires_at) <= new Date()).length;
      const suspended = (tenants ?? []).filter(t => t.status === "suspended").length;
      const now = new Date();
      const monthly = (payments ?? []).filter(p => p.status === "paid" && new Date(p.payment_date).getMonth() === now.getMonth() && new Date(p.payment_date).getFullYear() === now.getFullYear()).reduce((s, p) => s + Number(p.amount), 0);
      const totalRev = (payments ?? []).filter(p => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);

      setStats([
        { label: "Total Clients", value: total, icon: Building2, color: "bg-blue-500" },
        { label: "Active Clients", value: active, icon: CheckCircle2, color: "bg-green-500" },
        { label: "Expired Clients", value: expired, icon: AlertOctagon, color: "bg-orange-500" },
        { label: "Suspended", value: suspended, icon: PauseCircle, color: "bg-red-500" },
        { label: "Monthly Revenue", value: `$${monthly.toFixed(2)}`, icon: DollarSign, color: "bg-emerald-500" },
        { label: "Total Revenue", value: `$${totalRev.toFixed(2)}`, icon: TrendingUp, color: "bg-teal-500" },
        { label: "Active Farms", value: farms?.length ?? 0, icon: Tractor, color: "bg-amber-500" },
        { label: "Total Users", value: tu?.length ?? 0, icon: Users, color: "bg-purple-500" },
      ]);
      const { data: bk } = await supabase
        .from("backup_history")
        .select("created_at, status, backup_type")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      setLastBackup(bk as any);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-zinc-400 text-sm">System-wide overview</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-zinc-400">{s.label}</CardTitle>
              <div className={`h-8 w-8 rounded-md flex items-center justify-center ${s.color}`}><s.icon className="h-4 w-4 text-white" /></div>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{s.value}</div></CardContent>
          </Card>
        ))}
      </div>
      <Link to="/super-admin/backups" className="block">
        <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Last Backup</CardTitle>
            <div className={`h-8 w-8 rounded-md flex items-center justify-center ${lastBackup?.status === "success" ? "bg-emerald-500" : lastBackup?.status === "warning" ? "bg-amber-500" : lastBackup?.status === "failed" ? "bg-red-500" : "bg-zinc-600"}`}>
              <Database className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lastBackup ? new Date(lastBackup.created_at).toLocaleString() : "No backups yet"}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {lastBackup ? `${lastBackup.backup_type} · ${lastBackup.status}` : "Click to create your first backup"}
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
};

export default Dashboard;