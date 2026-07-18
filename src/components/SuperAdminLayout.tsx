import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useSuperAdminAuth } from "@/hooks/useSuperAdminAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard, Users, CreditCard, Package, Receipt,
  Activity, Settings as SettingsIcon, LogOut, ShieldAlert, Building2, Database, Mail, Zap, HeartPulse, Menu
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/super-admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/super-admin/clients", label: "Clients", icon: Building2 },
  { to: "/super-admin/plans", label: "Plans", icon: Package },
  { to: "/super-admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/super-admin/payments", label: "Payments", icon: Receipt },
  { to: "/super-admin/users", label: "Users", icon: Users },
  { to: "/super-admin/logs", label: "Activity Logs", icon: Activity },
  { to: "/super-admin/backups", label: "Backups", icon: Database },
  { to: "/super-admin/backup-email", label: "Backup Emails", icon: Mail },
  { to: "/super-admin/jobs", label: "Background Jobs", icon: Zap },
  { to: "/super-admin/monitoring", label: "Monitoring", icon: HeartPulse },
  { to: "/super-admin/settings", label: "System Settings", icon: SettingsIcon },
];

const SuperAdminLayout = () => {
  const { loading, isSuperAdmin, signOut } = useSuperAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!loading && !isSuperAdmin) navigate("/super-admin/login", { replace: true });
  }, [loading, isSuperAdmin, navigate]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">Loading…</div>;
  if (!isSuperAdmin) return null;

  const SidebarBody = ({ onNav }: { onNav?: () => void }) => (
    <div className="w-full h-full bg-zinc-900 flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-zinc-800">
          <div className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-semibold leading-tight">Super Admin</div>
            <div className="text-[10px] uppercase tracking-wider opacity-60">Control Panel</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} onClick={onNav}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
                isActive ? "bg-red-600 text-white" : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
              )}>
              <it.icon className="h-4 w-4" /> {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-800">
          <Button variant="ghost" className="w-full justify-start text-zinc-300 hover:bg-zinc-800 hover:text-white" onClick={async () => { await signOut(); navigate("/super-admin/login", { replace: true }); }}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
    </div>
  );

  return (
    <div className="super-admin-scope min-h-screen flex bg-zinc-950 text-white overflow-x-hidden">
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-zinc-800">
        <SidebarBody />
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center px-3 gap-2 border-b border-zinc-800 bg-zinc-900 pt-[env(safe-area-inset-top)]">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="h-11 w-11 text-zinc-100 hover:bg-zinc-800"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[85vw] max-w-[320px] bg-zinc-900 border-zinc-800">
              <SidebarBody onNav={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" />
            <span className="font-semibold truncate">Super Admin</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto w-full min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default SuperAdminLayout;