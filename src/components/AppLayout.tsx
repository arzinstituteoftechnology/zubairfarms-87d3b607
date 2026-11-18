import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import {
  LayoutDashboard, Beef, Tractor, Store, ShoppingCart, Truck,
  Boxes, Settings as SettingsIcon, LogOut, Menu, ClipboardCheck,
  Users, Wallet, Receipt, TruckIcon, HandCoins, History, Skull, FileBarChart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { SubscriptionGate } from "@/components/SubscriptionGate";
import { useModuleFlags } from "@/hooks/useModuleFlags";
import { PermissionsProvider, usePermissions, ROUTE_MODULE } from "@/hooks/usePermissions";
import { RequirePermission } from "@/components/RequirePermission";
import { useLocation } from "react-router-dom";
import { UsersRound, Activity, DatabaseBackup, ShieldCheck, HeartPulse, MessageSquare } from "lucide-react";

const navItems = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, end: true },
  { to: "/pos", key: "pos", icon: Receipt },
  { to: "/farms", key: "farms", icon: Tractor },
  { to: "/shops", key: "shops", icon: Store },
  { to: "/customers", key: "customers", icon: Users, customersModule: true },
  { to: "/suppliers", key: "suppliers", icon: Wallet },
  { to: "/shop-ledger", key: "shop_ledger", icon: Wallet },
  { to: "/daily-recovery", key: "daily_recovery", icon: HandCoins },
  { to: "/purchases", key: "purchases", icon: ShoppingCart },
  { to: "/supplies", key: "supplies", icon: Truck },
  { to: "/expenses", key: "expenses", icon: Wallet },
  { to: "/trucks", key: "trucks", icon: TruckIcon },
  { to: "/deliveries", key: "deliveries", icon: Truck },
  { to: "/inventory", key: "inventory", icon: Boxes },
  { to: "/stock-closing", key: "stock_closing", icon: ClipboardCheck },
  { to: "/closing-history", key: "closing_history", icon: History },
  { to: "/mortality-register", key: "mortality_register", icon: Skull },
  { to: "/reports", key: "reports", icon: FileBarChart },
  { to: "/settings", key: "settings", icon: SettingsIcon, adminOnly: true, end: true },
];

const SidebarContent = ({ role, onSignOut, customersEnabled, onNavigate }: { role: string | null; onSignOut: () => void; customersEnabled: boolean; onNavigate?: () => void }) => {
  const { t } = useTranslation();
  const { can, isOwner } = usePermissions();
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
      {navItems
        .filter((n) => !n.adminOnly || isOwner)
        .filter((n: any) => !n.customersModule || customersEnabled)
        .filter((n) => {
          const mod = ROUTE_MODULE[n.to];
          return !mod || can(mod, "view");
        })
        .map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
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
      {isOwner && (
        <NavLink
          to="/settings/users"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
            isActive ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <UsersRound className="h-4 w-4" /> Users & Permissions
        </NavLink>
      )}
      {isOwner && (
        <NavLink
          to="/settings/activity"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
            isActive ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Activity className="h-4 w-4" /> Activity Center
        </NavLink>
      )}
      {isOwner && (
        <NavLink
          to="/settings/backup-restore"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
            isActive ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <DatabaseBackup className="h-4 w-4" /> Backup & Restore
        </NavLink>
      )}
      {isOwner && (
        <NavLink
          to="/settings/subscription"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
            isActive ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <ShieldCheck className="h-4 w-4" /> Subscription
        </NavLink>
      )}
      {isOwner && (
        <NavLink
          to="/settings/system-health"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
            isActive ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <HeartPulse className="h-4 w-4" /> System Health
        </NavLink>
      )}
      {isOwner && (
        <NavLink
          to="/settings/sms-notifications"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[44px]",
            isActive ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <MessageSquare className="h-4 w-4" /> SMS Notifications
        </NavLink>
      )}
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
  const { customers_module_enabled } = useModuleFlags();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!loading && !session) navigate("/login", { replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <SubscriptionGate>
    <PermissionsProvider>
    <div className="min-h-screen flex bg-background overflow-x-hidden">
      <aside className="hidden lg:block w-64 shrink-0 border-r border-sidebar-border">
        <SidebarContent role={role} onSignOut={handleSignOut} customersEnabled={customers_module_enabled} />
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 h-14 border-b flex items-center px-3 gap-2 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pt-[env(safe-area-inset-top)]">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="h-11 w-11"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[85vw] max-w-[320px]">
              <SidebarContent role={role} onSignOut={handleSignOut} customersEnabled={customers_module_enabled} onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0">
            <Beef className="h-5 w-5 text-primary shrink-0" />
            <span className="font-semibold truncate">{t("app.name")}</span>
          </div>
          <div className="ms-auto flex items-center gap-1"><LanguageSwitcher /><NotificationBell /></div>
        </header>
        <div className="border-b bg-card px-3 py-2 sm:px-4 sm:py-3 lg:px-6 flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{t("dashboard.select_date")}</label>
            <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value || today)} className="force-ltr w-full sm:w-[180px]" />
          </div>
          <Button variant="outline" size="sm" disabled={isToday} onClick={() => setSelectedDate(today)} className="h-10 shrink-0">{t("dashboard.today_btn")}</Button>
          <div className="ms-auto hidden lg:block"><NotificationBell /></div>
        </div>
        <main className="flex-1 overflow-auto">
          <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto w-full min-w-0">
            <RequirePermission key={location.pathname}>
              <Outlet />
            </RequirePermission>
          </div>
        </main>
      </div>
    </div>
    </PermissionsProvider>
    </SubscriptionGate>
  );
};

export default AppLayout;