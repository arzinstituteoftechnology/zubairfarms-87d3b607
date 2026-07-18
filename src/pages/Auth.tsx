import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, loading } = useAuth();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signin" | "forgot">(() => {
    const params = new URLSearchParams(location.search);
    return params.get("mode") === "forgot" ? "forgot" : "signin";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate("/", { replace: true });
  }, [session, loading, navigate]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      try {
        await (supabase as any).rpc("log_auth_event", {
          _event: "failed_login",
          _success: false,
          _metadata: { email, error: error.message, user_agent: navigator.userAgent },
        });
      } catch { /* ignore */ }
    } else navigate("/", { replace: true });
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
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background p-4">
      <SeoHead
        title="Sign in — Zubair MeatFlow"
        description="Sign in to Zubair MeatFlow to manage farms, shops, POS sales, ledgers and deliveries."
        path="/auth"
      />
      <h1 className="sr-only">Sign in to Zubair MeatFlow</h1>
      <Card className="w-full max-w-md shadow-xl border-border/60">
        <div className="flex justify-end px-4 pt-3"><LanguageSwitcher aria-label="Switch language" /></div>
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <ShieldCheck className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">{t("app.name")} — Sign In</CardTitle>
          <CardDescription>Authorized access only. Accounts are created by your administrator.</CardDescription>
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
          ) : (
          <form onSubmit={onLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("auth.email")}</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("auth.password")}</Label>
              <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "…" : t("auth.sign_in")}</Button>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground w-full text-center" onClick={() => setMode("forgot")}>
              {t("auth.forgot_password")}
            </button>
          </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default Auth;
