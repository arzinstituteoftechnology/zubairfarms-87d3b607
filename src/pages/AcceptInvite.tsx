import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; full_name?: string; tenant_role: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) { setError("Missing invitation token"); setLoading(false); return; }
      const { data, error } = await supabase.functions.invoke("accept-user-invitation", {
        body: { token, preview: true },
      });
      if (error || (data as any)?.error) {
        setError((data as any)?.error ?? error?.message ?? "Invalid invitation");
      } else {
        setInvite(data as any);
        setFullName((data as any).full_name ?? "");
      }
      setLoading(false);
    })();
  }, [token]);

  const accept = async () => {
    if (password.length < 8) { toast({ title: "Password too short", description: "Use at least 8 characters", variant: "destructive" }); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("accept-user-invitation", {
      body: { token, password, full_name: fullName },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast({ title: "Could not accept invitation", description: (data as any)?.error ?? error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Welcome!", description: "Your account is ready. Please sign in." });
    navigate("/auth");
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-muted/30">
      <Card className="w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Accept invitation</h1>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verifying invitation…</div>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : invite ? (
          <>
            <p className="text-sm text-muted-foreground">
              You've been invited as <span className="font-medium capitalize">{invite.tenant_role.replace("_", " ")}</span>. Set your details to activate the account.
            </p>
            <div><Label>Email</Label><Input value={invite.email} disabled /></div>
            <div><Label>Full name</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
            <div><Label>Choose a password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" /></div>
            <Button className="w-full" disabled={busy} onClick={accept}>{busy ? "Activating…" : "Accept & activate"}</Button>
          </>
        ) : null}
      </Card>
    </div>
  );
}