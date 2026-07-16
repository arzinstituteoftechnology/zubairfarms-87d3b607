# Final Phase — Regression Fixes + Reports Center

Feature-frozen scope. No new accounting/inventory/closing features. Two strict phases; Phase 2 does not start until Phase 1's critical tests pass.

## Phase 1 — Regression audit & bug fixing

### 1.1 Reconciliation harness (source-of-truth checks)
Add a temporary, tenant-scoped SQL audit script (not shipped) that, for each tenant + date, compares:

- Expected Closing (raw source-table sum) vs `computeExpectedClosing` helper vs `stock_closings.expected_closing_kg`.
- Gross Profit (raw supplies) vs `computeGrossProfit` vs Dashboard KPI.
- Net Profit (formula) vs Dashboard KPI vs `finalize_stock_closing` shortage_cost snapshot.
- Farm Payable (raw purchases − farm_payments − reversal offsets) vs `farmPayable.ts`.
- Shop Receivable (raw supplies + opening + adj − recoveries − reversals) vs `shopReceivable.ts`.
- Next-day opening = latest finalized unreversed physical closing.

Run for 3 sampled tenants × 3 dates (balanced / shortage / surplus). Only mismatches drive fixes.

### 1.2 Scenario tests (unit + integration)
Extend the existing vitest suite. One test per scenario, each asserting exact numeric equality with the raw source-table calculation:

- Balanced, Shortage, Surplus, Draft, Finalized, Reversed closing
- Mortality, Weight loss, Positive adj, Negative adj
- Purchase / Supply / Recovery / Farm-payment reversal
- Expense + Delivery expense inclusion (no double count)
- Duplicate transaction guard (idempotency keys, unique constraints)
- Cross-tenant leakage guard (RLS via `rls-isolation-test` edge fn)
- Selected-date switching (no stale cache)
- Prev-day finalized → next-day opening rollover
- Draft closing does NOT affect profit or opening
- Reversed closing restores stock + profit + KPIs

### 1.3 Fix policy
- Fix only confirmed mismatches / failing tests.
- Root-cause each: identify source (helper / RPC / query / trigger) and fix at the source, not the report.
- Every schema/RPC/trigger fix ships as one migration with a plain-English description.
- Every data-repair action logs to `activity_logs`.
- Do not rewrite passing formulas.

### 1.4 Gate to Phase 2
Phase 2 does not begin until: tsgo clean, `bun test` green, all 1.2 scenarios pass, and 1.1 harness reports zero mismatches on the sampled tenants/dates.

## Phase 2 — Reports Center

One `Reports.tsx` shell with a left-side report picker and shared filter bar. All reports read via existing helpers / RPCs — no new calculation formulas.

### 2.1 Shared infrastructure
- `src/components/reports/ReportShell.tsx` — title, filter bar, summary cards, table, export buttons, loading / empty / error states, tenant + company header for exports.
- `src/components/reports/FilterBar.tsx` — From, To, quick ranges (Today / Week / Month / Custom), Meat Type, Farm, Shop, Variance Type, Closing Status, Reason, Created By, Finalized By, Reversal Status. Filters that don't apply to a report are hidden per-report.
- `src/lib/reportExport.ts` — CSV, XLSX (xlsx-js-style or SheetJS already usable via CSV fallback if not installed), PDF (jsPDF + autotable) and Print. All four consume the same filtered dataset returned by the report hook — never a re-query. Header block: company name, tenant name, report title, active filters, generated-at, page numbers.
- `src/hooks/useReportData.ts` — generic wrapper: takes report id + filters, calls the report's tenant-scoped fetcher, returns `{ data, summary, loading, error, retry }`.

### 2.2 The 10 reports
Each is a thin fetcher + column definition. All fetchers strictly tenant-scoped, exclude reversed rows where required, respect selected date range.

1. Daily Closing Report — full `stock_closings` row expansion (all columns from spec).
2. Shortage Report — `status='finalized' AND reversed_at IS NULL AND variance_type='shortage'`.
3. Surplus Report — same filter, `variance_type='surplus'`. Info-only, does not feed profit.
4. Inventory Variance Report — Expected vs Physical, variance %, daily/weekly/monthly rollups via SQL `date_trunc`.
5. Mortality Analysis — from `mortality_register` (or existing source), joined to farms.
6. Weight Loss Analysis — from `stock_adjustments` where reason='water_loss' / weight-loss category.
7. Stock Adjustment Analysis — positive vs negative split with reversal status.
8. Profit Reconciliation Report — Gross − General Exp − Delivery Exp − Finalized Shortage = Net. Must equal Dashboard Profit KPI for the same range; asserted in an integration test.
9. Payable & Receivable Report — farm payables + shop receivables + net working capital + top-N lists, reusing `farmPayable` / `shopReceivable` helpers.
10. Reversal & Audit Report — from `activity_logs` filtered to reversal actions, joined to original entity.

### 2.3 UI details
- Responsive (mobile: card list; tablet+: table).
- Sortable columns, search, pagination, summary cards above table.
- Row click → drill-down modal (existing detail dialogs where available; otherwise read-only JSON view of the row).
- Status badges + colour rules (red = shortage/loss, green = surplus/healthy, neutral = balanced).
- Warning banner when a draft/missing closing exists in the selected range.

### 2.4 Acceptance tests (must all pass)
Automated integration tests in `src/lib/reportReconciliation.test.ts`:

- For 3 fixture dates (balanced / shortage / surplus):
  - Dashboard totals == Reports Center totals
  - Closing History totals == Reports Center totals
  - Inventory totals == Reports Center totals
  - Net Profit == reconciliation formula
  - Shortage cost counted exactly once
  - Reversed rows excluded from active totals
  - Draft closing excluded from finalized totals
  - Next-day opening == latest finalized physical closing
- Export tests: CSV / XLSX / PDF payload totals match on-screen totals (assert on the exporter's input array, not the rendered file).
- `tsgo` clean, production `vite build` clean, no console errors on report navigation, no duplicate realtime channels (guard already in place; assert).

## Deliverables at end
Final implementation report with: confirmed bugs, root causes, files changed, migrations, RPC/trigger changes, tests executed with pass/fail, before/after evidence for each fixed calculation, dashboard↔reports reconciliation table, and any remaining limitations. Daily Closing, Inventory Variance and Reports Center marked FEATURE COMPLETE only after all acceptance tests pass.

## Out of scope
No new accounting rules, no surplus-into-profit, no new KPIs, no unrelated UI redesign, no new tables (audit uses existing `activity_logs`).
