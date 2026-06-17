import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabaseSuperAdmin as supabase } from "@/integrations/supabase/superAdminClient";
import { useSuperAdminAuth } from "@/hooks/useSuperAdminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

const SuperAdminLogin = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isSuperAdmin, loading, refresh } = useSuperAdminAuth();
  const [mode, setMode] = useState<"signin" | "signup">(searchParams.get("setup") === "1" ? "signup" : "signin");
  const [saExists, setSaExists] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && isSuperAdmin) navigate("/super-admin", { replace: true });
  }, [loading, isSuperAdmin, navigate]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("super_admin_exists");
      const exists = !!data;
      setSaExists(exists);
      if (exists && mode === "signup") setMode("signin");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // Rate limit check
    const { data: lock } = await supabase.rpc("super_admin_login_lockout", { _email: email });
    if (typeof lock === "number" && lock > 0) {
      setBusy(false);
      return toast.error(`Too many failed attempts. Try again in ${Math.ceil(lock / 60)} minute(s).`);
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      await supabase.rpc("record_super_admin_login_attempt", { _email: email, _success: false });
      setBusy(false);
      return toast.error(error.message);
    }
    // After a full reset, email confirmation may complete before the role is claimed.
    // This RPC only grants super_admin when no super_admin exists yet.
    const { error: bootstrapErr } = await supabase.rpc("bootstrap_super_admin");
    if (bootstrapErr) {
      await supabase.rpc("record_super_admin_login_attempt", { _email: email, _success: false });
      await supabase.auth.signOut();
      setBusy(false);
      return toast.error(bootstrapErr.message);
    }

    const { data: saCheck, error: saErr } = await supabase.rpc("is_super_admin");
    if (saErr) {
      await supabase.rpc("record_super_admin_login_attempt", { _email: email, _success: false });
      await supabase.auth.signOut();
      setBusy(false);
      return toast.error(saErr.message);
    }
    if (!saCheck) {
      await supabase.rpc("record_super_admin_login_attempt", { _email: email, _success: false });
      await supabase.auth.signOut();
      setBusy(false);
      return toast.error("This account is not a super admin.");
    }
    await supabase.rpc("record_super_admin_login_attempt", { _email: email, _success: true });
    await refresh();
    setBusy(false);
    toast.success("Welcome, Super Admin");
    navigate("/super-admin", { replace: true });
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saExists) return toast.error("A Super Admin already exists. Bootstrap is permanently disabled.");
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/super-admin/login`, data: { full_name: fullName || email } },
    });
    if (error) { setBusy(false); return toast.error(error.message); }
    if (!data.session) {
      // need email confirmation
      setBusy(false);
      return toast.success("Check your email to confirm, then sign in.");
    }
    // claim super_admin
    const { data: claimed, error: rpcErr } = await supabase.rpc("bootstrap_super_admin");
    if (rpcErr) { setBusy(false); return toast.error(rpcErr.message); }
    if (!claimed) {
      await supabase.auth.signOut();
      setBusy(false);
      return toast.error("Super admin already exists. Sign in instead.");
    }
    await refresh();
    setBusy(false);
    toast.success("Super admin account created!");
    navigate("/super-admin", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-4">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-red-600 flex items-center justify-center mb-2">
            <ShieldAlert className="h-7 w-7 text-white" />
          </div>
          <CardTitle>Super Admin {mode === "signup" ? "— Bootstrap" : "Console"}</CardTitle>
          <CardDescription className="text-zinc-400">
            {mode === "signup" ? "Create the first super admin account." : "Restricted access. Authorized personnel only."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "signin" ? (
            <form onSubmit={onSignIn} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-zinc-800 border-zinc-700" />
              </div>
              <Button type="submit" variant="destructive" className="w-full" disabled={busy}>{busy ? "…" : "Sign In"}</Button>
              {saExists === false && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-red-700 bg-zinc-900 text-red-200 hover:bg-red-950 hover:text-red-100"
                  onClick={() => setMode("signup")}
                >
                  Create the first Super Admin account
                </Button>
              )}
            </form>
          ) : (
            <form onSubmit={onSignUp} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-zinc-800 border-zinc-700" />
              </div>
              <Button type="submit" variant="destructive" className="w-full" disabled={busy}>{busy ? "…" : "Create Super Admin"}</Button>
              <button type="button" className="text-xs text-zinc-400 hover:text-zinc-100 w-full text-center" onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLogin;