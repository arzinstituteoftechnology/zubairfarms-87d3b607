import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "staff" | "manager" | "super_admin";

export interface TenantInfo { id: string; company_name: string; status: string }
export interface SubInfo {
  id: string; tenant_id: string; plan_id: string | null;
  expires_at: string; status: string;
  plan?: { name: string; billing_cycle: string } | null;
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  role: Role | null;
  loading: boolean;
  isSuperAdmin: boolean;
  tenant: TenantInfo | null;
  subscription: SubInfo | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  role: null,
  loading: true,
  isSuperAdmin: false,
  tenant: null,
  subscription: null,
  refresh: async () => {},
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [subscription, setSubscription] = useState<SubInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const clearProfile = () => {
    setRole(null);
    setIsSuperAdmin(false);
    setTenant(null);
    setSubscription(null);
  };

  const loadProfile = async (userId: string) => {
    clearProfile();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user || authData.user.id !== userId) {
      await supabase.auth.signOut();
      return;
    }

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const list = (roles ?? []).map((r) => r.role as Role);
    const superAdmin = list.includes("super_admin");
    if (superAdmin) {
      // Super Admin accounts must NOT hold a tenant session.
      // Force sign-out from the tenant client; the user can still use
      // the separate /super-admin/login session.
      await supabase.auth.signOut();
      setIsSuperAdmin(false);
      setTenant(null);
      setSubscription(null);
      return;
    }
    setIsSuperAdmin(false);
    setRole(list.includes("admin") ? "admin" : list[0] ?? null);

    const { data: tu } = await supabase.from("tenant_users").select("tenant_id, tenants(id, company_name, status)").eq("user_id", userId).maybeSingle();
    const t = (tu as any)?.tenants ?? null;
    setTenant(t);
    if (t) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id, tenant_id, plan_id, expires_at, status, subscription_plans(name, billing_cycle)")
        .eq("tenant_id", t.id)
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sub) {
        setSubscription({
          id: sub.id, tenant_id: sub.tenant_id, plan_id: sub.plan_id,
          expires_at: sub.expires_at, status: sub.status,
          plan: (sub as any).subscription_plans ?? null,
        });
      } else setSubscription(null);
    } else setSubscription(null);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        setLoading(true);
        setTimeout(async () => { await loadProfile(s.user.id); setLoading(false); }, 0);
      } else {
        clearProfile();
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ session, user: session?.user ?? null, role, loading, isSuperAdmin, tenant, subscription, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);