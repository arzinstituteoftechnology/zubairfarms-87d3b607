import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabaseSuperAdmin } from "@/integrations/supabase/superAdminClient";

interface SuperAdminAuthCtx {
  session: Session | null;
  user: User | null;
  isSuperAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SuperAdminAuthCtx>({
  session: null,
  user: null,
  isSuperAdmin: false,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export const SuperAdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const verify = async (s: Session | null) => {
    if (!s?.user) {
      setIsSuperAdmin(false);
      return;
    }
    const { data: freshUser, error: freshUserError } = await supabaseSuperAdmin.auth.getUser();
    if (freshUserError || !freshUser.user) {
      setIsSuperAdmin(false);
      await supabaseSuperAdmin.auth.signOut();
      return;
    }
    const { data, error } = await supabaseSuperAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", freshUser.user.id);
    if (error) {
      setIsSuperAdmin(false);
      return;
    }
    const ok = (data ?? []).some((r: any) => r.role === "super_admin");
    setIsSuperAdmin(ok);
    if (!ok) {
      // session exists but not super admin — clear it from this client
      await supabaseSuperAdmin.auth.signOut();
    }
  };

  useEffect(() => {
    const { data: sub } = supabaseSuperAdmin.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(true);
      setTimeout(async () => {
        await verify(s);
        setLoading(false);
      }, 0);
    });
    supabaseSuperAdmin.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await verify(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = async () => {
    const { data } = await supabaseSuperAdmin.auth.getSession();
    setSession(data.session);
    await verify(data.session);
  };

  const signOut = async () => {
    await supabaseSuperAdmin.auth.signOut();
    setSession(null);
    setIsSuperAdmin(false);
  };

  return (
    <Ctx.Provider value={{ session, user: session?.user ?? null, isSuperAdmin, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useSuperAdminAuth = () => useContext(Ctx);