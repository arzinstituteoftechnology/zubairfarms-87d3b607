import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TenantRole = "owner" | "manager" | "cashier" | "data_entry" | "read_only";
export type Module =
  | "dashboard" | "pos" | "farms" | "shops" | "supplier_ledger" | "shop_ledger"
  | "daily_recovery" | "purchases" | "supplies" | "expenses" | "trucks" | "deliveries"
  | "inventory" | "stock_closing" | "closing_history" | "mortality_register"
  | "reports" | "settings" | "backup_restore" | "users";
export type Action = "view" | "create" | "edit" | "delete" | "reverse" | "print" | "export" | "approve" | "reset";

interface PermCtx {
  loading: boolean;
  tenantRole: TenantRole | null;
  status: "active" | "disabled" | null;
  isOwner: boolean;
  can: (module: Module, action: Action) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PermCtx>({
  loading: true, tenantRole: null, status: null, isOwner: false,
  can: () => false, refresh: async () => {},
});

type Key = string;
const k = (m: string, a: string): Key => `${m}::${a}`;

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { session, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenantRole, setTenantRole] = useState<TenantRole | null>(null);
  const [status, setStatus] = useState<"active" | "disabled" | null>(null);
  const [perms, setPerms] = useState<Record<Key, boolean>>({});

  const load = useCallback(async () => {
    if (!session?.user) { setLoading(false); return; }
    setLoading(true);
    // tenant_users
    const { data: tu } = await (supabase as any).from("tenant_users")
      .select("tenant_role, status").eq("user_id", session.user.id).maybeSingle();
    const role = (tu?.tenant_role as TenantRole) ?? null;
    setTenantRole(role);
    setStatus((tu?.status as any) ?? null);

    if (role === "owner" || isSuperAdmin) {
      setPerms({});
      setLoading(false);
      return;
    }
    const [{ data: rolePerms }, { data: overrides }] = await Promise.all([
      (supabase as any).from("role_permissions").select("module, action, allowed").eq("role", role ?? "read_only"),
      (supabase as any).from("user_permission_overrides").select("module, action, allowed").eq("user_id", session.user.id),
    ]);
    const map: Record<Key, boolean> = {};
    (rolePerms ?? []).forEach((r: any) => { map[k(r.module, r.action)] = !!r.allowed; });
    (overrides ?? []).forEach((r: any) => { map[k(r.module, r.action)] = !!r.allowed; });
    setPerms(map);
    setLoading(false);
  }, [session, isSuperAdmin]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.user) return;
    const ch = supabase
      .channel("perm-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "role_permissions" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_permission_overrides" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_users", filter: `user_id=eq.${session.user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, load]);

  const isOwner = tenantRole === "owner" || isSuperAdmin;

  const can = useCallback((module: Module, action: Action): boolean => {
    if (isSuperAdmin) return true;
    if (status === "disabled") return false;
    if (tenantRole === "owner") return true;
    return perms[k(module, action)] === true;
  }, [perms, tenantRole, isSuperAdmin, status]);

  const value = useMemo(() => ({ loading, tenantRole, status, isOwner, can, refresh: load }), [loading, tenantRole, status, isOwner, can, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const usePermissions = () => useContext(Ctx);

// Convenience wrapper component
export const Can = ({ module, action, children, fallback = null }: { module: Module; action: Action; children: ReactNode; fallback?: ReactNode }) => {
  const { can } = usePermissions();
  return <>{can(module, action) ? children : fallback}</>;
};

// Route→module mapping
export const ROUTE_MODULE: Record<string, Module> = {
  "/": "dashboard", "/dashboard": "dashboard", "/pos": "pos",
  "/farms": "farms", "/shops": "shops", "/customers": "shops",
  "/suppliers": "supplier_ledger", "/shop-ledger": "shop_ledger",
  "/daily-recovery": "daily_recovery", "/purchases": "purchases",
  "/supplies": "supplies", "/expenses": "expenses", "/trucks": "trucks",
  "/deliveries": "deliveries", "/inventory": "inventory",
  "/stock-closing": "stock_closing", "/closing-history": "closing_history",
  "/mortality-register": "mortality_register", "/reports": "reports",
  "/settings": "settings",
};