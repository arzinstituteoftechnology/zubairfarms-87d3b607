# Phase 3 — Daily Closing: Full Integration

Builds on the Phase 2 foundation (schema, RPCs, helpers, Dashboard cards, Closing History). This phase completes the remaining 13 items.

## 1. Database migration (single file)

- **Reasons expansion**: seed new `stock_adjustment_reasons` (system rows, per-tenant): `bird_dead`, `bird_missing`, `transport_loss`, `shop_counting_error`, `water_loss`, `returned_birds`, `manual_adjustment` (keep existing ones). Idempotent seed.
- **Permissions** (add to `role_permissions` defaults):
  - `stock_closing.delete` → admin/super_admin only
  - `stock_closing.edit_finalized` → admin/super_admin only
  - staff: keep only `view`, `create`, `edit_draft`
- **Finalize-lock guards** — new trigger `guard_edit_after_finalized_closing()` attached to `purchases`, `supplies`, `shop_recoveries`, `expenses`, `stock_adjustments` (already have mortality via adjustments). On UPDATE/DELETE, block when a **finalized unreversed** `stock_closings` row exists for same `tenant_id + meat_type` (where applicable) with `closing_date >= row_date`. Message: "Cannot edit — a finalized closing exists on/after this date. Reverse the closing first." Super admin bypasses.
- **Validation** in `finalize_stock_closing` RPC: reject if `expected < 0`, `physical < 0`, or `variance != 0 && reason is null`. Duplicate-per-day already unique-constrained; surface a clean message.
- **Dashboard RPC** `dashboard_closing_summary(p_tenant, p_date)` returns one JSON row: per-meat + totals (opening, purchases, supplies, pos_adj, neg_adj, mortality, expected, physical, variance, shortage_cost, surplus_value, status). Uses same helpers as Inventory to guarantee one source.

## 2. Shared TS helper

- `src/lib/inventoryReconciliation.ts`: builds per-meat reconciliation rows for a date range from raw purchases/supplies/adjustments/closings using `closingVariance` helpers. Used by Inventory, Dashboard summary fallback, and Reports.
- `src/lib/closingAlerts.ts`: derives banner list (pending, draft, negative stock, large shortage/surplus, reverse-pending) from summary + settings thresholds (default 5% & 10kg).

## 3. Inventory page

Rebuild `src/pages/Inventory.tsx` reconciliation table per meat type with columns:
Opening · + Purchases · − Supplies · + Pos Adj · − Neg Adj · − Mortality · Expected · Physical · Difference · Status
Date picker; totals row; status pill (grey/red/green).

## 4. Closing History

Extend `src/pages/ClosingHistory.tsx` columns: add Surplus Value, Created By, Reverse By, Reverse Time (Reverse Status already shown). Keep existing filters.

## 5. Reports Center

Add to `src/pages/Reports.tsx` a "Daily Closing" report group with tabs:
- Daily Closing (per-meat reconciliation for range)
- Expected vs Physical (chart + table)
- Shortage / Surplus reports (filtered lists)
- Variance Trend (line by day)
- Monthly Shortage Cost / Surplus Value (bar)
- Actions: Print, Export PDF (existing `printReport`), Export Excel (new `xlsx` via SheetJS-lite CSV fallback to keep bundle small — use CSV download to stay dependency-free).

## 6. Dashboard

- Replace the ~20 per-KPI queries with one call to `dashboard_closing_summary` + existing profit/expense queries.
- Add missing cards: Closing Difference %, Surplus Estimated Value (already added → keep), colored grey/red/green per rule.
- Profit card: add formula breakdown block (Gross − General − Delivery − Finalized Shortage = Net).
- Alerts banner list from `closingAlerts.ts`.

## 7. Audit log

Every finalize/reverse already logs via `audit_financial_change` + `stamp_edited_audit`. Add explicit `activity_logs` inserts inside `finalize_stock_closing` and `reverse_stock_closing` capturing `reason_changed`, `adjustment_added`, `mortality_added` metadata (IP already captured in `audit_financial_change`).

## 8. Frontend permission gating

Update `RequirePermission` usage on Stock Closing actions:
- Finalize button → `stock_closing.finalize`
- Reverse → `stock_closing.reverse`
- Delete draft → `stock_closing.delete`
- Edit finalized → `stock_closing.edit_finalized`
- Staff sees only Save Draft.

## 9. Next-day opening

Already derived in Phase 2 via `computeCurrentStock`. Add explicit guard: ignore drafts (`status='finalized' AND reversed_at IS NULL`). Add unit test.

## 10. Validation & tests

- Vitest: reconciliation helper, alerts helper, next-day opening ignores drafts, netProfit unchanged.
- Manual smoke via preview.

## Out of scope

Purchases/Supplies/Recovery/Expense business logic unchanged except for the finalize-lock trigger. No new tables. No notification/monitoring changes.

## Files

**New**: `src/lib/inventoryReconciliation.ts`, `src/lib/inventoryReconciliation.test.ts`, `src/lib/closingAlerts.ts`, `src/lib/closingAlerts.test.ts`, `src/components/ClosingAlertsBanner.tsx`, `src/components/ProfitBreakdown.tsx`, migration file.

**Edited**: `src/pages/Inventory.tsx`, `src/pages/Reports.tsx`, `src/pages/Dashboard.tsx`, `src/pages/StockClosing.tsx`, `src/pages/ClosingHistory.tsx`, `src/integrations/supabase/types.ts` (after migration), `src/lib/netProfit.ts` (only if breakdown export needed).

Approve to proceed and I will ship as one integrated change (migration first for approval, then code).
