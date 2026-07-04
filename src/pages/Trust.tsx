import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Shield, Lock, Database, Users, Cookie, FileText, AlertTriangle, Mail } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";

/**
 * MeatFlow ERP — Trust & Security overview.
 * This page is app-owned editable content. It describes the controls that are
 * actually wired into the application and the platform features the app runs
 * on. It is not an independent certification or audit report.
 */
const Trust = () => {
  return (
    <div className="min-h-screen bg-background">
      <SeoHead
        title="Trust & Security — Zubair MeatFlow"
        description="How MeatFlow ERP protects your data: authentication, tenant isolation, backups, and platform security controls."
        path="/trust"
      />
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
            <Shield className="h-5 w-5 text-primary" />
            MeatFlow ERP
          </Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <section className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">Trust & Security</h1>
          <p className="text-muted-foreground">
            This page is maintained by the MeatFlow ERP operator to answer common
            security and privacy questions about the application. It describes
            controls that are currently enabled in the product and the platform
            it runs on. It is not a certification, audit report, or independent
            verification.
          </p>
          <p className="text-sm text-muted-foreground">
            Last reviewed: {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </section>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Access & authentication</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Users sign in with an email and password managed by our backend
              auth provider. Sessions are stored in the browser and refreshed
              automatically. Password resets are performed through a one-time
              email link.
            </p>
            <p>
              The app uses role-based access control. Each account is assigned a
              role (for example: super admin, admin, staff) stored in a
              dedicated roles table — never on user profile data — and access to
              business data is checked on every request, both in the UI and in
              the database.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Data isolation & storage</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              MeatFlow ERP is multi-tenant: each client account ("tenant") has
              its own shops, customers, farms, ledgers, purchases, supplies,
              expenses, recoveries, deliveries and inventory. Database row-level
              security rules scope every read and write to the tenant the
              signed-in user belongs to.
            </p>
            <p>
              Data is hosted on managed Lovable Cloud infrastructure (Supabase /
              PostgreSQL) with encryption in transit (HTTPS/TLS) and encryption
              at rest provided by the platform. The operator does not store
              additional copies of customer data outside the platform other
              than the backups described below.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Lock className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Backups & recovery</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              The product includes an automated daily backup of database
              contents and system settings, stored in a private storage bucket
              that is not publicly accessible. The super admin can restore from
              a backup and can configure notification email recipients for
              backup success/failure alerts.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Data we collect & how it is used</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              MeatFlow ERP records the business data you enter into it: shop,
              farm, customer, supplier, purchase, supply, delivery, expense,
              inventory, payment and ledger records, together with the email
              address of each user and basic activity logs (who created or
              edited which record and when).
            </p>
            <p>
              This data is used only to operate the application for your
              tenant. It is not sold, and it is not shared with third parties
              other than the subprocessors listed below.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Subprocessors & integrations</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>The application currently relies on the following providers:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium text-foreground">Lovable Cloud</span> (hosting,
                database, authentication, storage, edge functions).
              </li>
              <li>
                <span className="font-medium text-foreground">Email delivery</span> for
                authentication and backup notifications, via the platform's
                managed email service.
              </li>
            </ul>
            <p>
              Additional integrations require explicit configuration by the
              operator and are not enabled by default.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Cookie className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Cookies & analytics</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              The app stores a session token and a small number of UI
              preferences (such as the selected ledger date and language) in
              your browser's local storage. No third-party advertising or
              behavioural-tracking cookies are set by the application itself.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Retention, deletion & privacy requests</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Business records are retained for as long as your tenant account
              is active so they remain available for reporting and ledger
              continuity. To request deletion of an account, an export of your
              tenant's data, or correction of personal information, contact
              the operator using the address below.
            </p>
            <p>
              Shared responsibility: the operator manages account-level
              deletion and exports; individual record edits and deletions
              within a tenant are controlled by that tenant's own admins and
              staff.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Reporting a security issue</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              If you believe you have found a security vulnerability in
              MeatFlow ERP, please report it privately to the operator using
              the contact address below. Please do not publicly disclose the
              issue before we have had a reasonable opportunity to investigate
              and respond.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Contact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              For security reports, privacy questions, data-deletion requests,
              or general questions about this page, contact the MeatFlow ERP
              operator through the support channel provided to your tenant
              administrator.
            </p>
          </CardContent>
        </Card>

        <Separator />

        <p className="text-xs text-muted-foreground">
          This page describes controls and practices that are currently in
          place. It is editable content maintained by the operator of this
          MeatFlow ERP deployment and is not a Lovable-issued certification or
          independent audit. Specific compliance certifications (such as SOC 2,
          ISO 27001, GDPR, HIPAA or PCI) are not claimed on this page.
        </p>
      </main>
    </div>
  );
};

export default Trust;