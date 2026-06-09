import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  LayoutDashboard, Beef, Tractor, Store, ShoppingCart, Truck,
  Boxes, Settings as SettingsIcon, LogOut, Menu,
  Users, Wallet, Receipt, TruckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLedgerDate } from "@/hooks/useLedgerDate";

const navItems = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, end: true },
  { to: "/pos", key: "pos", icon: Receipt },
  { to: "/farms", key: "farms", icon: Tractor },
  { to: "/shops", key: "shops", icon: Store },
  { to: "/customers", key: "customers", icon: Users },
  { to: "/suppliers", key: "suppliers", icon: Wallet },
  { to: "/purchases", key: "purchases", icon: ShoppingCart },
  { to: "/supplies", key: "supplies", icon: Truck },
  { to: "/expenses", key: "expenses", icon: Wallet },
  { to: "/trucks", key: "trucks", icon: TruckIcon },
  { to: "/deliveries", key: "deliveries", icon: Truck },
  { to: "/inventory", key: "inventory", icon: Boxes },
  { to: "/settings", key: "settings", icon: SettingsIcon, adminOnly: true },
];

const SidebarContent = ({ role, onSignOut }: { role: string | null; onSignOut: () => void }) => {
  const { t } = useTranslation();
  return (
  <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="flex h-16 items-center gap-2 px-5 border-b border-sidebar-border">
      <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
        <Beef className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{t("app.name")}</div>
        <div className="text-[10px] uppercase tracking-wider opacity-60">{role ?? "—"}</div>
      </div>
    </div>
    <div className="px-3 py-2 border-b border-sidebar-border flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wider opacity-60">{t("lang.switch")}</span>
      <LanguageSwitcher />
    </div>
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {navItems.filter((n) => !n.adminOnly || role === "admin").map((n) => (
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
          {t(`nav.${n.key}`)}
        </NavLink>
      ))}
    </nav>
    <div className="p-3 border-t border-sidebar-border">
      <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={onSignOut}>
        <LogOut className="h-4 w-4" /> {t("nav.sign_out")}
      </Button>
    </div>
  </div>
  );
};

const AppLayout = () => {
  const { session, loading, role, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { selectedDate, setSelectedDate, today, isToday } = useLedgerDate();

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!loading && session && role && role !== "admin") {
      signOut().then(() => navigate("/auth", { replace: true }));
    }
  }, [loading, session, role, signOut, navigate]);

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
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
            <span className="font-semibold">{t("app.name")}</span>
          </div>
          <div className="ml-auto"><LanguageSwitcher /></div>
        </header>
        <div className="border-b bg-card px-4 py-3 md:px-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{t("dashboard.select_date")}</label>
            <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value || today)} className="force-ltr w-[180px]" />
          </div>
          <Button variant="outline" size="sm" disabled={isToday} onClick={() => setSelectedDate(today)}>{t("dashboard.today_btn")}</Button>
        </div>
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