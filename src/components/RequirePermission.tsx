import { ReactNode } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { usePermissions, ROUTE_MODULE, Module, Action } from "@/hooks/usePermissions";
import { ShieldAlert } from "lucide-react";

export const RequirePermission = ({ children, module, action = "view" }: {
  children: ReactNode; module?: Module; action?: Action;
}) => {
  const { pathname } = useLocation();
  const { loading, can, status } = usePermissions();
  if (loading) return <div className="p-8 text-muted-foreground">Checking permissions…</div>;

  if (status === "disabled") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center p-6">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <h2 className="text-xl font-semibold">Account disabled</h2>
        <p className="text-muted-foreground max-w-md">Your account has been disabled by the Owner. Please contact them to regain access.</p>
      </div>
    );
  }

  const mod = module ?? ROUTE_MODULE[pathname];
  if (!mod) return <>{children}</>;
  if (can(mod, action)) return <>{children}</>;

  // Redirect to first accessible page
  const fallback = can("dashboard", "view") ? "/dashboard" : "/settings";
  if (pathname === fallback) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center p-6">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <h2 className="text-xl font-semibold">No access</h2>
        <p className="text-muted-foreground">You don't have permission to view any modules. Contact the Owner.</p>
      </div>
    );
  }
  return <Navigate to={fallback} replace />;
};