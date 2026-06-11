import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

const Auth = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isFirstUser, setIsFirstUser] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate("/", { replace: true });
  }, [session, loading, navigate]);

  useEffect(() => {
    // Detect if any user exists yet. profiles is readable by authenticated only,
    // so use head+count and treat 0 (no rows visible while signed-out) as "unknown".
    // We rely on a public RPC? Simpler: attempt count on profiles; if it fails or 0, assume first-user flow.
    (async () => {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (error) {
        setIsFirstUser(true); // likely no rows / RLS — default to showing signup
      } else {
        setIsFirstUser((count ?? 0) === 0);
      }
    })();
  }, []);

  useEffect(() => {
    if (isFirstUser) setMode("signup");
  }, [isFirstUser]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else navigate("/", { replace: true });
  };

  const onSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName || email },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data.session) {
      toast.success(isFirstUser ? "Admin account created!" : "Account created!");
      navigate("/", { replace: true });
    } else {
      toast.success("Check your email to confirm your account.");
      setMode("signin");
    }
  };

  const onForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error(t("auth.enter_email_first"));
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("auth.reset_sent"));
      setMode("signin");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border/60">
        <div className="flex justify-end px-4 pt-3"><LanguageSwitcher /></div>
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <ShieldCheck className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">
            {t("app.name")} — {mode === "signup" ? (isFirstUser ? "Create Admin" : "Sign Up") : "Admin"}
          </CardTitle>
          <CardDescription>
            {mode === "signup" && isFirstUser
              ? "First account becomes the system administrator."
              : mode === "signup"
              ? "Create a new staff account."
              : "Authorized access only"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "forgot" ? (
            <form onSubmit={onForgot} className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("auth.email")}</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>{t("auth.send_reset_link")}</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("signin")}>
                {t("auth.back_to_signin")}
              </Button>
            </form>
          ) : mode === "signup" ? (
            <form onSubmit={onSignup} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("auth.email")}</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("auth.password")}</Label>
                <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "…" : isFirstUser ? "Create Admin Account" : "Create Account"}
              </Button>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground w-full text-center" onClick={() => setMode("signin")}>
                Already have an account? Sign in
              </button>
            </form>
          ) : (
          <form onSubmit={onLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("auth.email")}</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("auth.password")}</Label>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "…" : t("auth.sign_in")}</Button>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground w-full text-center" onClick={() => setMode("forgot")}>
              {t("auth.forgot_password")}
            </button>
            {isFirstUser && (
              <button type="button" className="text-xs text-primary hover:underline w-full text-center pt-2 border-t" onClick={() => setMode("signup")}>
                No accounts yet — create the admin account
              </button>
            )}
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
