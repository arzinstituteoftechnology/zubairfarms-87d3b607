import { ReactNode, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const SubscriptionGate = ({ children }: { children: ReactNode }) => {
  const { loading, session, isSuperAdmin, tenant, subscription } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (loading || !session || isSuperAdmin) return;
    if (!tenant) { navigate("/subscription-expired?reason=none", { replace: true }); return; }
    if (tenant.status === "suspended") { navigate("/subscription-expired?reason=suspended", { replace: true }); return; }
    if (!subscription) { navigate("/subscription-expired?reason=none", { replace: true }); return; }
    const exp = new Date(subscription.expires_at).getTime();
    if (exp < Date.now()) navigate("/subscription-expired?reason=expired", { replace: true });
  }, [loading, session, isSuperAdmin, tenant, subscription, navigate]);

  const isExpired = subscription ? new Date(subscription.expires_at).getTime() < Date.now() : false;
  const isBlocked = !!session && !isSuperAdmin && (!tenant || tenant.status === "suspended" || !subscription || isExpired);
  const daysLeft = subscription ? Math.ceil((new Date(subscription.expires_at).getTime() - Date.now()) / 86400000) : null;
  const showWarn = !dismissed && daysLeft !== null && daysLeft > 0 && daysLeft <= 7;

  if (isBlocked) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Checking account access…</div>;
  }

  return (
    <>
      {showWarn && (
        <div className="bg-yellow-500/15 border-b border-yellow-500/30 text-yellow-900 dark:text-yellow-200 px-4 py-2 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Your subscription expires in <strong>{daysLeft} day{daysLeft === 1 ? "" : "s"}</strong>. Contact your administrator to renew.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}><X className="h-4 w-4" /></Button>
        </div>
      )}
      {children}
    </>
  );
};