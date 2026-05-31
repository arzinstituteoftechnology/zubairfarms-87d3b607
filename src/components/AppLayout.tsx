import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import {
  LayoutDashboard, Beef, Tractor, Store, ShoppingCart, Truck,
  Boxes, AlertTriangle, Settings as SettingsIcon, LogOut, Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/farms", label: "Farms", icon: Tractor },
  { to: "/shops", label: "Shops", icon: Store },
  { to: "/purchases", label: "Purchases", icon: ShoppingCart },
  { to: "/supplies", label: "Supplies", icon: Truck },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/wastage", label: "Wastage", icon: AlertTriangle },
  { to: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
];

const SidebarContent = ({ role, onSignOut }: { role: string | null; onSignOut: () => void }) => (
  <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="flex h-16 items-center gap-2 px-5 border-b border-sidebar-border">
      <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
        <Beef className="h-5 w-5 text-primary-foreground" />
      </div>
      <div>
        <div className="font-semibold leading-tight">MeatFlow</div>
        <div className="text-[10px] uppercase tracking-wider opacity-60">{role ?? "—"}</div>
      </div>
    </div>
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {nav.filter((n) => !n.adminOnly || role === "admin").map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )
          }
        >
          <n.icon className="h-4 w-4" />
          {n.label}
        </NavLink>
      ))}
    </nav>
    <div className="p-3 border-t border-sidebar-border">
      <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={onSignOut}>
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  </div>
);

const AppLayout = () => {
  const { session, loading, role, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:block w-64 shrink-0 border-r border-sidebar-border">
        <SidebarContent role={role} onSignOut={handleSignOut} />
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden h-14 border-b flex items-center px-4 gap-3 bg-card">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64">
              <SidebarContent role={role} onSignOut={handleSignOut} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <Beef className="h-5 w-5 text-primary" />
            <span className="font-semibold">MeatFlow</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="p-4 md:p-6 max-w-7xl mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;