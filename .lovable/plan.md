# Enterprise Users & Permissions — Phase 1

Accounting is frozen. This plan builds on the existing RBAC (roles, per-user overrides, disable, Super Admin override, `has_permission`, `activity_logs`) and adds the four capabilities you approved.

## 1. Permission Audit Log

New table `permission_audit_log` (tenant-scoped, append-only):
- actor_user_id, actor_email, actor_ip, actor_user_agent (browser/device)
- target_user_id, target_email
- action: `role_changed | status_changed | override_set | override_cleared | role_template_created | role_template_updated | role_template_deleted | bulk_role_applied | bulk_permissions_copied | bulk_permissions_reset | invite_sent | invite_resent | invite_revoked | invite_accepted`
- previous_value / new_value (jsonb) — for role: `{role}`, for override: `{module, action, allowed}`, for template: full permission map snapshot
- reason (text, required for role/status/template deletes)
- created_at

Existing triggers on `tenant_users`, `role_permissions`, `user_permission_overrides` already write to `activity_logs`. The new table is a **richer, structured mirror** dedicated to permission events, populated by:
- A new trigger `audit_permission_event()` on the three tables that decodes op → action and writes the specific shape.
- Edge functions (invites, bulk actions) that write directly with actor IP/UA from request headers.

New page `PermissionAudit.tsx` (Owner-only tab in Users & Permissions):
- Filters: actor, target, action type, date range
- Search across actor/target names + reason
- Sortable table, pagination
- Row expand → full before/after JSON diff
- Exports: CSV, Excel (xlsx), PDF (jsPDF + autotable, reusing `reportExport.ts` from Reports Center)

RLS: only Owner or Super Admin can read; only DB triggers and `service_role` can write (no user INSERT policy). Append-only trigger `activity_logs_append_only` pattern reused.

## 2. Editable Role Templates

New table `role_templates`:
- tenant_id, name (unique per tenant), description
- is_builtin (5 seed rows: owner/manager/cashier/data_entry/read_only, `tenant_id = NULL`)
- created_by, created_at, updated_at

New table `role_template_permissions`: template_id, module, action, allowed (unique constraint).

New table `role_template_versions`: template_id, version_no, snapshot (jsonb of full permission map), reason, created_by, created_at — one row per save enables rollback.

Migration copies existing hardcoded 5-role permission matrix into `role_templates` + `role_template_permissions` with `is_builtin = true`, then rewrites `has_permission` to read from `role_template_permissions` joined via `tenant_users.role_template_id` (new column, default = matching built-in template id per role name). Backward compatible — existing `tenant_role` column stays; templates just extend it.

New tab "Role Templates" in Users & Permissions:
- List built-in + custom templates
- Actions: **Clone** (opens editor pre-filled), **Rename** (custom only), **Edit permissions** (custom only; built-in are read-only), **Delete** (custom + zero assigned users only), **Version history** with restore
- Editor: same MxA grid as existing per-user editor
- Every save writes a version row + audit log entry with reason

Guard trigger `guard_role_template_delete`: reject if any `tenant_users.role_template_id` still references it or if `is_builtin`.

## 3. Bulk Permission Actions

New "Bulk Actions" toolbar on the Users table (multi-select checkboxes on each row):
- **Assign role in bulk** → dialog picks target role → preview diff table (user | old role | new role | permission delta count) → Apply
- **Copy permissions from user** → picker: source user → target users receive same role + overrides (previewed)
- **Reset to template defaults** → clears all `user_permission_overrides` for selected users (previewed)

New edge function `bulk-permission-action` (Owner-only): validates permission, wraps everything in a single transaction via a new RPC `apply_bulk_permission_action(action, source_user_id, target_user_ids, new_role, reason)`, returns per-user success/failure, writes one audit row per user + one summary row.

## 4. Invite by Email

New table `user_invitations`:
- tenant_id, email (unique-active per tenant), tenant_role, role_template_id
- token (opaque 64-byte random, hashed with sha256 for storage), token_hash
- status: `pending | accepted | expired | cancelled`
- expires_at (default now() + 72h), sent_at, accepted_at, cancelled_at
- invited_by, accepted_user_id, resend_count, force_password_change (default true)

Two edge functions:
- `owner-invite-user`: Owner-only. Generates token, stores hash, sends email via existing Lovable Emails infrastructure (adds a new template `user-invitation` under `_shared/transactional-email-templates/`), returns invite id. If Lovable Emails is not yet configured, respond with a clear message and stop — do NOT scaffold email infra automatically (respects feature freeze scope for email).
- `accept-user-invitation`: Public. Verifies token+expiry+one-time-use, creates auth user if new (or attaches existing), inserts `tenant_users` row with the invited role, marks invite accepted, sets `must_change_password = true` on `profiles`.

New page `/invite/accept?token=…` (unauthenticated): validates token via edge function, shows accept form (name + password), on success sends to `/auth` for first login.

Existing "Add User" dialog in `UsersPermissions.tsx` gets a segmented control: **Create directly** (existing flow, kept) | **Send invitation** (new). Invitations list shown below the users table with Resend / Revoke buttons and status badge.

First-login flow: `useAuth` reads `profiles.must_change_password`; if true, redirects to a new `/change-password` gate before any protected route resolves.

## 5. Files (new + edited)

New:
- `supabase/migrations/…_enterprise_rbac_phase1.sql` (one migration; all tables, RLS, GRANTs, triggers, seed data, `apply_bulk_permission_action` RPC, `must_change_password` column on profiles)
- `supabase/functions/owner-invite-user/index.ts`
- `supabase/functions/accept-user-invitation/index.ts`
- `supabase/functions/bulk-permission-action/index.ts`
- `supabase/functions/_shared/transactional-email-templates/user-invitation.tsx`
- `src/pages/PermissionAudit.tsx`
- `src/pages/RoleTemplates.tsx`
- `src/pages/AcceptInvite.tsx`
- `src/pages/ChangePassword.tsx`
- `src/components/permissions/BulkActionsBar.tsx`
- `src/components/permissions/InvitationsList.tsx`
- `src/lib/permissionAuditExport.ts`
- Test files for each new lib/util + integration test for `apply_bulk_permission_action`

Edited:
- `src/pages/UsersPermissions.tsx` — tabs (Users / Invitations / Role Templates / Audit), multi-select rows, Bulk Actions bar, Invite variant of Add User dialog
- `src/hooks/usePermissions.tsx` — respects `role_template_id` when set (falls back to `tenant_role`)
- `src/App.tsx` — routes for `/invite/accept`, `/change-password`, and sub-routes of `/users`
- `src/hooks/useAuth.tsx` — expose `mustChangePassword`, redirect gate

## 6. Enterprise guarantees

- Zero regression: existing per-user override editor, Owner-only guard, disable-user, Super Admin override all preserved.
- RLS: every new table has policies + GRANTs following the standard pattern (Owner-scoped reads; writes gated by RPC/edge functions where needed).
- Tenant isolation: every table has `tenant_id` + `current_tenant_id()` filter; invitations key on `(tenant_id, email)`.
- Audit integrity: `permission_audit_log` and `role_template_versions` are append-only (delete/update policies denied).
- Tests: unit tests for token hashing, expiry math, bulk-diff computation; integration tests via `supabase.functions.invoke` mocks; existing 41 tests must remain green.
- Types: `tsgo --noEmit` clean. Production build clean.

## 7. Order of execution

1. Migration (creates schema; user approves it separately before code lands)
2. After approval: edge functions + templates + pages + wiring
3. Tests
4. `tsgo` + build + full vitest run
5. Final report with pass/fail per acceptance check

Nothing in Phase 2 (Audit Logs viewer for all events) or Phase 3 (Backup/Restore) is included — those ship after Phase 1 is signed off.
