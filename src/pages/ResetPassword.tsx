import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Beef, Loader2 } from "lucide-react";

type RecoveryState = "loading" | "ready" | "invalid";

const INVALID_RESET_LINK_MESSAGE = "This password reset link is invalid or expired. Please request a new link.";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const markReadyIfSessionExists = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session?.access_token) setRecoveryState("ready");
      return Boolean(data.session?.access_token);
    };

    const fail = () => {
      if (!cancelled) setRecoveryState("invalid");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" && session?.access_token) {
        setRecoveryState("ready");
      }
    });

    const establishRecoverySession = async () => {
      setRecoveryState("loading");
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashType = hashParams.get("type");

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) return fail();
          if (!(await markReadyIfSessionExists())) fail();
          return;
        }

        if (accessToken && refreshToken && (!hashType || hashType === "recovery")) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) return fail();
          if (!(await markReadyIfSessionExists())) fail();
          return;
        }

        // If Supabase already consumed the URL tokens before this effect ran,
        // allow the form only when a real session is present.
        if (!(await markReadyIfSessionExists())) fail();
      } catch {
        fail();
      }
    };

    void establishRecoverySession();
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error(t("auth.password_too_short"));
    if (password !== confirm) return toast.error(t("auth.passwords_dont_match"));
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) {
      setRecoveryState("invalid");
      return toast.error(INVALID_RESET_LINK_MESSAGE);
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    await supabase.auth.signOut();
    toast.success("Password updated successfully. Please sign in.");
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <div className="flex justify-end px-4 pt-3"><LanguageSwitcher /></div>
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <Beef className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">{t("auth.reset_title")}</CardTitle>
          <CardDescription>{t("auth.reset_subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recoveryState === "loading" ? (
            <p className="text-sm text-muted-foreground text-center">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
              {t("auth.waiting_recovery")}
            </p>
          ) : recoveryState === "invalid" ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">{INVALID_RESET_LINK_MESSAGE}</p>
              <Button type="button" className="w-full" onClick={() => navigate("/auth", { replace: true })}>
                {t("auth.back_to_signin")}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("auth.new_password")}</Label>
                <PasswordInput required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("auth.confirm_password")}</Label>
                <PasswordInput required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>{t("auth.update_password")}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;