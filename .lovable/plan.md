# Enterprise Phase 4 — Backup & Disaster Recovery

The Super Admin already has a working backup pipeline (`system-backup` edge function, `backup_history`, `backup_settings`, Storage bucket `system-backups`). Phase 4 extends it to tenant Owners and adds the missing enterprise guarantees. **Nothing in accounting, inventory, reports, RBAC, or audit is touched.**

## 1. Backup Center (tenant Owner)

New page `/settings/backup-restore` (Owner-only, sidebar link under Users & Permissions).

Header cards show:
- Last Backup (name + time + status)
- Next Scheduled Backup (from tenant settings)
- Backup Status (last state + last error)
- Total Backup Size (sum of `file_size` for tenant)
- Storage Location (Lovable Cloud Storage — bucket `system-backups`)
- Encryption Status (gzip + storage encryption at rest — Enabled)
- Retention Policy (from tenant settings)

## 2. Manual Backup

Owner clicks "Create Backup Now" → calls `system-backup` edge function with `action: "create"`, `backup_type: "manual"`, `tenant_id: <owner tenant>`. Existing snapshot covers every listed table (users, roles, permissions, purchases, supplies, shops, farms, deliveries, trucks, expenses, recoveries, ledgers, inventory, mortality — via `stock_adjustments`, daily closing, closing history, reports data, settings, activity logs, role templates).

## 3. Automatic Backup Scheduler (per tenant)

New table `tenant_backup_settings`:

- `tenant_id` PK
- `schedule` enum: `off | hourly | every_6h | daily | weekly | monthly`
- `retain_backups` int default 30
- `next_run_at` timestamptz
- `updated_by`, `updated_at`

Owner-scoped RLS + GRANTs. UI: schedule dropdown + retention input + "Save".

Cron:
- Reuse existing pg_cron infra. Add hourly job that calls a new edge function `tenant-backup-scheduler`, which iterates `tenant_backup_settings` where `next_run_at <= now()` and invokes `system-backup` with the tenant's id, then bumps `next_run_at` by the interval.

## 4. Restore Wizard

Multi-step dialog on the Backup Center:

1. Select Backup (from tenant's history)
2. Validate → calls `action: "verify"` (schema check, checksum recompute, tenant match)
3. Preview → shows `table_counts` from stored `health`
4. Warning screen (destructive action banner + type "RESTORE" to confirm)
5. Confirm → calls `action: "restore"` with `tenant_id`
6. Progress → poll `backup_history` row for the pre-restore backup and result
7. Finish → success/rollback summary

Wizard state managed by a small lib `src/lib/backupWizard.ts` (pure state machine, testable).

## 5. Backup Validation & Checksum

Extend `system-backup`:
- On create: compute SHA-256 of gzip bytes → store in new column `backup_history.checksum_sha256`. Include `schema_version = "1.0"` in payload.
- On verify: recompute checksum, compare, verify `payload.schema_version`, verify `payload.tenant_id` matches row `tenant_id`, verify tenant row present. Return `{ ok, checksum_ok, schema_ok, tenant_ok, tables }`.

Restore refuses to run when any check fails.

## 6. Restore Preview

Preview step displays `table_counts` (users, purchases, supplies, inventory, expenses, recoveries, settings, audit logs, closing history) + `Backup Date`, `Schema Version`, `Size`, `Checksum` (first 12 chars).

## 7. Point-in-Time Restore

Owner can select any historical row from the tenant's `backup_history` and restore it. Existing SA flow keeps working unchanged.

## 8. Backup Encryption

- In-transit: HTTPS (Storage signed URL, 5-min TTL)
- At-rest: Lovable Cloud Storage default AES encryption + gzip compression
- Integrity: SHA-256 checksum stored + verified before every restore
- No plaintext backup ever emitted from the edge function

## 9. Backup History

Table columns: Name, Date, Size, Created By, Manual/Automatic (from `backup_type`), Status, Restore, Download, Delete. Pagination + status filter.

New RPC `delete_backup(_id uuid, _reason text)` (SECURITY DEFINER, Owner-of-tenant or Super Admin): removes storage object + row, writes `activity_logs` entry.

## 10. Disaster Recovery / Rollback

Extend `handleRestore` in `system-backup`:
- Take pre_restore backup first (already done).
- Run restore inside a try/catch; if any table upsert fails **or** post-restore verify fails, automatically call `handleRestore` again against the pre_restore backup id (safe: uses the same code path with `rolling_back: true` flag to skip creating another pre_restore).
- Return `{ ok: false, rolled_back: true, error }` when rollback ran. UI surfaces this in the wizard's Finish step.

## 11. Security

- New RLS: `backup_history` gains `"tenant owner reads own tenant backups"` (SELECT scoped to `tenant_id = current_tenant_id()` AND `is_tenant_owner(auth.uid())`); existing Super Admin policy unchanged.
- `tenant_backup_settings` gets full RLS (Owner-only for their tenant + Super Admin).
- All create/verify/restore/delete operations already write to `activity_logs` (Phase 3 audit center picks them up).
- Edge function permission: tenant Owner may only call actions scoped to their own tenant_id — enforced server-side by re-fetching `tenant_users` and rejecting mismatches.

## 12. Performance

- Snapshots already gzip'd + streamed. No change.
- Restore uses upsert-in-order (parents → children); unchanged.
- Wizard shows a busy state during long calls.
- Progress hook polls `backup_history` row every 2s.

## 13. Testing

Unit tests (vitest):
- `src/lib/backupChecksum.test.ts` — SHA-256 hex over known bytes, `verifyChecksum` accept/reject.
- `src/lib/backupWizard.test.ts` — state machine: forward transitions, reject on validation failure, rollback path, cannot skip Warning step.
- `src/lib/backupSchedule.test.ts` — `nextRunAt(schedule, from)` for hourly/6h/daily/weekly/monthly.

Existing SA Backups page and edge function stay green (no signature changes; only additive columns + new payload field + new checksum logic; all pre-existing calls remain compatible).

Acceptance:
- `tsgo --noEmit` clean
- Production build clean
- All 53+ new tests pass, existing suite still green

## Files

New:
- Migration (`backup_history.checksum_sha256`, `backup_history.schema_version`, `tenant_backup_settings` table + RLS + GRANTs, RLS policy addition on `backup_history`, `delete_backup` RPC)
- `supabase/functions/tenant-backup-scheduler/index.ts`
- `src/pages/BackupRestore.tsx`
- `src/components/backup/RestoreWizard.tsx`
- `src/lib/backupChecksum.ts` + `.test.ts`
- `src/lib/backupWizard.ts` + `.test.ts`
- `src/lib/backupSchedule.ts` + `.test.ts`

Edited:
- `supabase/functions/system-backup/index.ts` (checksum, schema_version, verify checks, rollback, tenant Owner authorization)
- `src/App.tsx` (route)
- `src/components/AppLayout.tsx` (sidebar link)

Cron job registered via `supabase--insert` (not migration — contains project URL + anon key).

## Order of execution

1. Migration (schema + RLS + RPC)
2. Edge function updates (system-backup + new tenant-backup-scheduler)
3. Cron registration
4. UI (page + wizard + libs + tests)
5. Verify: `tsgo`, `vitest run`, build
6. Final report
