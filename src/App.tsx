import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Farms from "./pages/Farms";
import Shops from "./pages/Shops";
import Purchases from "./pages/Purchases";
import Supplies from "./pages/Supplies";
import Inventory from "./pages/Inventory";
import StockClosing from "./pages/StockClosing";
import ClosingHistory from "./pages/ClosingHistory";
import MortalityRegister from "./pages/MortalityRegister";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Customers from "./pages/Customers";
import Suppliers from "./pages/Suppliers";
import ShopLedger from "./pages/ShopLedger";
import DailyRecovery from "./pages/DailyRecovery";
import Expenses from "./pages/Expenses";
import Trucks from "./pages/Trucks";
import Deliveries from "./pages/Deliveries";
import POS from "./pages/POS";
import Invoice from "./pages/Invoice";
import SubscriptionExpired from "./pages/SubscriptionExpired";
import SuperAdminLogin from "./pages/super-admin/SuperAdminLogin";
import SuperAdminLayout from "./components/SuperAdminLayout";
import SADashboard from "./pages/super-admin/Dashboard";
import SAClients from "./pages/super-admin/Clients";
import SAPlans from "./pages/super-admin/Plans";
import SASubscriptions from "./pages/super-admin/Subscriptions";
import SAPayments from "./pages/super-admin/Payments";
import SAUsers from "./pages/super-admin/Users";
import SALogs from "./pages/super-admin/ActivityLogs";
import SASettings from "./pages/super-admin/SystemSettings";
import SABackups from "./pages/super-admin/Backups";
import SABackupEmail from "./pages/super-admin/BackupEmailSettings";
import SAJobs from "./pages/super-admin/BackgroundJobs";
import SAMonitoring from "./pages/super-admin/Monitoring";
import Trust from "./pages/Trust";
import { SuperAdminAuthProvider } from "@/hooks/useSuperAdminAuth";
import UsersPermissions from "./pages/UsersPermissions";
import Notifications from "./pages/Notifications";
import AcceptInvite from "./pages/AcceptInvite";
import ActivityCenter from "./pages/ActivityCenter";
import BackupRestore from "./pages/BackupRestore";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/login" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/trust" element={<Trust />} />
            <Route path="/subscription-expired" element={<SubscriptionExpired />} />
            <Route
              path="/super-admin/login"
              element={
                <SuperAdminAuthProvider>
                  <SuperAdminLogin />
                </SuperAdminAuthProvider>
              }
            />
            <Route
              path="/super-admin"
              element={
                <SuperAdminAuthProvider>
                  <SuperAdminLayout />
                </SuperAdminAuthProvider>
              }
            >
              <Route index element={<SADashboard />} />
              <Route path="clients" element={<SAClients />} />
              <Route path="plans" element={<SAPlans />} />
              <Route path="subscriptions" element={<SASubscriptions />} />
              <Route path="payments" element={<SAPayments />} />
              <Route path="users" element={<SAUsers />} />
              <Route path="logs" element={<SALogs />} />
              <Route path="settings" element={<SASettings />} />
              <Route path="backups" element={<SABackups />} />
              <Route path="backup-email" element={<SABackupEmail />} />
              <Route path="jobs" element={<SAJobs />} />
              <Route path="monitoring" element={<SAMonitoring />} />
            </Route>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/farms" element={<Farms />} />
              <Route path="/shops" element={<Shops />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/shop-ledger" element={<ShopLedger />} />
              <Route path="/daily-recovery" element={<DailyRecovery />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/supplies" element={<Supplies />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/trucks" element={<Trucks />} />
              <Route path="/deliveries" element={<Deliveries />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/stock-closing" element={<StockClosing />} />
              <Route path="/closing-history" element={<ClosingHistory />} />
              <Route path="/mortality-register" element={<MortalityRegister />} />
             <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/users" element={<UsersPermissions />} />
              <Route path="/settings/activity" element={<ActivityCenter />} />
              <Route path="/settings/backup-restore" element={<BackupRestore />} />
              <Route path="/notifications" element={<Notifications />} />
            </Route>
            <Route path="/invoice/:id" element={<Invoice />} />
            <Route path="/invite/accept" element={<AcceptInvite />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
