
# Multi-Tenant Poultry ERP SaaS — Phase 1 Foundation

This phase delivers the **SaaS backbone**: tenants, plans, subscriptions, manual payments, super admin panel, and tenant-scoped data isolation on every existing ERP table. The existing ERP UI keeps working — it just becomes scoped to the logged-in user's tenant. New modules (sheds, batches, birds, accounts, cash book, ledgers, advanced reports) are intentionally **not** in this phase and will come later.

## What you'll get

### 1. Fresh start
- Wipe all rows from every existing business table (farms, shops, customers, suppliers, purchases, supplies, expenses, trucks, deliveries, pos_sales, pos_sale_items, customer_payments, farm_payments).
- Delete all existing auth users and roles.
- After deploy: super admin signs in at `/super-admin/login`, creates plans, creates the first tenant, that tenant's owner signs in at `/auth`.

### 2. New database schema (additions only — existing ERP tables get a `tenant_id` column added)
- `tenants` — company info, owner contact, status (active/suspended), created_at
- `subscription_plans` — name, billing_cycle (trial/monthly/yearly), price, duration_days, features (jsonb), is_active
- `subscriptions` — tenant_id, plan_id, started_at, expires_at, status (active/expired/suspended/trial)
- `payments` — invoice_number, tenant_id, subscription_id, plan name snapshot, amount, payment_date, expiry_date, status (paid/pending/overdue/cancelled), notes
- `activity_logs` — actor user_id, tenant_id, action, entity, entity_id, metadata, created_at
- `app_role` enum extended with `super_admin` (existing: admin, staff)
- `tenant_users` — links auth users to a tenant + role within that tenant (admin/manager/staff)

### 3. Tenant data isolation (RLS)
Every existing ERP table gets:
- A `tenant_id uuid not null` column.
- A `current_tenant_id()` security-definer function that reads the caller's tenant from `tenant_users`.
- Policies replaced so SELECT/INSERT/UPDATE/DELETE only match rows where `tenant_id = current_tenant_id()`.
- Super admin bypass policy: `has_role(auth.uid(), 'super_admin')` can read all rows (for "Login As Client" and reports).

### 4. Super Admin Panel (separate login)
- Route `/super-admin/login` — isolated login form, only `super_admin` role accepted, everyone else rejected.
- Route `/super-admin` (protected) with sidebar:
  - **Dashboard** — Total/Active/Expired/Suspended clients, Monthly Revenue, Total Revenue, Active Farms, Total Users.
  - **Clients** — list, create (company/farm/owner/mobile/email/password/country/city — creates auth user + tenant + tenant_user + assigns plan), edit, suspend, activate, delete, reset password, assign plan, extend subscription.
  - **Plans** — CRUD + activate/deactivate. Seeded with Free Trial (15d), Basic M/Y, Pro M/Y, Enterprise M/Y.
  - **Subscriptions** — list all, filter by status, manual extend.
  - **Payments** — record manual payment (auto-generates invoice number, sets expiry, marks paid/pending/overdue/cancelled), list, edit status.
  - **Users** — list every tenant user, role, last login.
  - **Activity Logs** — paginated audit log.
  - **System Settings** — app name, currency, default trial days.
  - **Login As Client** — issues a "view-as" session (sets a tenant override claim in localStorage that the client reads; UI shows a red banner with "Exit").

### 5. Tenant signup & subscription enforcement
- `/auth` keeps working for tenant owners/staff. New self-signup is **disabled** — tenants are created by super admin only (matches your manual-payment model).
- New `SubscriptionGate` wraps `AppLayout`:
  - Loads the tenant's active subscription on login.
  - If `expires_at < now()` → redirects to `/subscription-expired` page (shows plan, expiry, "Contact admin to renew", logout button).
  - If `expires_at - now() ≤ 7d/3d/1d` → shows a dismissible warning banner at the top.
  - Tenant suspended → redirects to `/subscription-expired` with "Account suspended" message.

### 6. Roles
- `super_admin` — full system access, only routes under `/super-admin`.
- `admin` (client admin) — full access within their tenant (existing behavior preserved).
- `manager`, `staff` — schema-ready; UI gating stays as today (admin-only Settings page). Detailed per-module gating is Phase 2.

### 7. Manual payments workflow
- Super admin opens a tenant → "Record Payment" → picks plan, enters amount + payment_date → system creates `payments` row + extends/creates `subscriptions` row by the plan's `duration_days` → tenant access auto-restored. No payment gateway, no webhooks.

## Out of scope for Phase 1 (will be follow-ups)
- New ERP modules: sheds, batches, bird stock, equipment inventory, accounts/cash book/ledgers, receivable/payable, profit-loss & advanced reports.
- Per-module RBAC (manager vs staff differences inside the ERP).
- Automated cron jobs (daily subscription check, email reminders, backups). Expiry is enforced live on every page load instead — same result without infra.
- Email notifications for warnings/expiry (no email provider connected yet).
- Stripe/Paddle. Can be bolted on later without touching tenancy.

## Technical notes

### Migration strategy (one big migration)
1. `TRUNCATE` all existing business tables + `auth.users` (cascade).
2. `ALTER TYPE app_role ADD VALUE 'super_admin'`, `'manager'`.
3. Create new tables: `tenants`, `subscription_plans`, `subscriptions`, `payments`, `activity_logs`, `tenant_users`.
4. `ALTER TABLE … ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` on every ERP table.
5. `CREATE OR REPLACE FUNCTION current_tenant_id()` — security definer, returns tenant from `tenant_users` for `auth.uid()`.
6. `DROP POLICY … CREATE POLICY` on every ERP table → tenant-scoped + super-admin-bypass.
7. Rewrite `handle_new_user()` — no longer auto-grants admin to first user; new auth users only get role/tenant when super admin creates them.
8. Seed the 7 default plans.
9. GRANTs on every new public table (authenticated + service_role; never anon).

### Code changes
- `useAuth` extended: returns `tenant`, `subscription`, `isSuperAdmin`, `viewAsTenantId`.
- `src/App.tsx` — add routes: `/super-admin/login`, `/super-admin/*`, `/subscription-expired`.
- New `src/components/SuperAdminLayout.tsx` + pages under `src/pages/super-admin/*`.
- New `src/components/SubscriptionGate.tsx` wrapping the existing `AppLayout`.
- Existing ERP pages: no UI changes; their Supabase queries automatically filter via RLS using `current_tenant_id()`. Inserts get `tenant_id` injected via a tiny helper `withTenant(payload)`.
- Banner component for expiry warnings.

### Seed plans
| Name | Cycle | Price | Days |
|---|---|---|---|
| Free Trial | trial | 0 | 15 |
| Basic Monthly | monthly | 9.99 | 30 |
| Basic Yearly | yearly | 99 | 365 |
| Professional Monthly | monthly | 29 | 30 |
| Professional Yearly | yearly | 290 | 365 |
| Enterprise Monthly | monthly | 99 | 30 |
| Enterprise Yearly | yearly | 990 | 365 |

(Editable from Plans page; currency configurable in System Settings.)

### Bootstrapping the first super admin
After the migration runs, you'll need to be promoted to `super_admin`. I'll insert a one-time SQL step that lets you sign up once at `/super-admin/login` → first account created there gets `super_admin` automatically. After that, only existing super admins can create new ones.

---

If this looks right, approve and I'll execute the migration and ship the code. Want any changes (e.g. different plan prices, different super-admin bootstrap, keep self-signup at `/auth`)? Tell me before approving.
