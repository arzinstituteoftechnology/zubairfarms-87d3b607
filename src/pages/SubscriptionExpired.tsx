import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, LogOut } from "lucide-react";

const SubscriptionExpired = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { tenant, subscription, signOut } = useAuth();
  const reason = params.get("reason") ?? "expired";

  const title = reason === "suspended" ? "Account Suspended" : reason === "none" ? "No Active Subscription" : "Subscription Expired";
  const body =
    reason === "suspended" ? "Your account has been suspended. Please contact your administrator."
    : reason === "none" ? "No subscription is assigned to your account yet. Please contact your administrator."
    : "Your subscription has expired. Please contact your administrator to renew access.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-destructive/15 flex items-center justify-center mb-2">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {tenant && <div className="text-center text-muted-foreground">Company: <strong className="text-foreground">{tenant.company_name}</strong></div>}
          {subscription && (
            <div className="text-center text-muted-foreground">
              Plan: <strong className="text-foreground">{subscription.plan?.name ?? "—"}</strong><br/>
              Expired: <strong className="text-foreground">{new Date(subscription.expires_at).toLocaleDateString()}</strong>
            </div>
          )}
          <Button variant="outline" className="w-full" onClick={async () => { await signOut(); navigate("/auth", { replace: true }); }}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SubscriptionExpired;