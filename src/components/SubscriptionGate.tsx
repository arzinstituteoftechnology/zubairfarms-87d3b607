import { ReactNode, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeState } from "@/lib/subscription";

export const SubscriptionGate = ({ children }: { children: ReactNode }) => {
  const { loading, session, isSuperAdmin, tenant, subscription, role } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const isOwner = role === "admin";

  const state = useMemo(() => {
    if (!subscription) return null;
    return computeState({
      expires_at: subscription.expires_at,
      cancelled_at: subscription.cancelled_at,
      is_trial: subscription.is_trial,
      tenant_status: tenant?.status,
      grace_period_days: subscription.grace_period_days ?? 0,
    });
  }, [subscription, tenant?.status]);

  useEffect(() => {
    if (loading || !session || isSuperAdmin) return;
    if (!tenant) { navigate("/subscription-expired?reason=none", { replace: true }); return; }
    if (tenant.status === "suspended") { navigate("/subscription-expired?reason=suspended", { replace: true }); return; }
    if (!subscription) { navigate("/subscription-expired?reason=none", { replace: true }); return; }
    if (state?.state === "grace" && isOwner) return; // owner allowed read-only during grace
    if (state?.state === "grace" && !isOwner) { navigate("/subscription-expired?reason=expired", { replace: true }); return; }
    if (state?.state === "expired" || state?.state === "cancelled") {
      navigate("/subscription-expired?reason=expired", { replace: true });
    }
  }, [loading, session, isSuperAdmin, tenant, subscription, navigate, state, isOwner]);

  const inGraceOwner = state?.state === "grace" && isOwner;
  const isBlocked = !!session && !isSuperAdmin && (!tenant || tenant.status === "suspended" || !subscription ||
    (state && ["expired","cancelled"].includes(state.state)) ||
    (state?.state === "grace" && !isOwner));
  const daysLeft = subscription ? Math.ceil((new Date(subscription.expires_at).getTime() - Date.now()) / 86400000) : null;
  const showWarn = !dismissed && daysLeft !== null && daysLeft > 0 && daysLeft <= 7;

  if (isBlocked) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Checking account access…</div>;
  }

  return (
    <>
      {inGraceOwner && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-200 px-4 py-2 flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Subscription expired — <strong>read-only mode</strong>. Grace period ends {state?.graceEndsAt?.toLocaleDateString()}. New data cannot be saved.
          </span>
        </div>
      )}
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