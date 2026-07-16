## Phase 2 — Daily Closing Variance Integration

Shipping in one pass per your answers: derived next-day opening (no new table), rolling 30-day WAR for shortage/surplus valuation, new permission keys.

### 1. Database migration (single file)

- Seed `role_permissions` rows for module `stock_closing`, actions: `view`, `create`, `edit_draft`, `finalize`, `reverse`, `export` (owner=all, admin=all, staff=view/create/edit_draft/export).
- Extend `reverse_stock_closing` RPC:
  - Require `stock_closing.reverse` (already wired via `assert_can_reverse_module`).
  - Refuse if a **later finalized, unreversed** closing exists for same `(tenant_id, meat_type)` — raise conflict `P0001` "Later finalized closing exists; reverse it first."
  - Idempotent (already checks `reversed_at`).
- Add RPC `public.finalize_stock_closing(p_id uuid)`:
  - Perms: `assert_permission('stock_closing','finalize')`.
  - Validates server-side: physical entered, variance_type set, sum of adjustment reasons equals |variance|, "other" requires notes.
  - Sets `status='finalized'`, `finalized_by`, `finalized_at`.
  - Recomputes and persists `shortage_cost` from **rolling 30-day WAR** per `meat_type` (unreversed purchases in `[closing_date-29, closing_date]`).
  - Writes `activity_logs` events `closing_finalized`.
- Add RPC `public.compute_closing_war(p_tenant uuid, p_meat text, p_date date) returns numeric` (SECURITY DEFINER, stable, tenant-scoped) — reused by finalize + client display.
- Ensure realtime publication includes `stock_closings`, `stock_adjustments` (already published purchases/supplies/expenses/deliveries — add any missing).
- Backfill safety: no data mutation to historical rows beyond what Phase 1 already did.

### 2. Shared helpers (single source of truth)

New `src/lib/closingVariance.ts`:

```ts
computeExpectedClosing({ opening, purchases, supplies, posAdj, negAdj, mortality })
classifyVariance(physical, expected) → { varianceWeight, varianceType, shortageWeight, surplusWeight }
valuedVariance(shortageWeight, surplusWeight, war) → { shortageCost, surplusEstimatedValue }
```

Update `src/lib/netProfit.ts`:

```ts
netProfit = grossProfit − generalExpense − deliveryExpense − finalizedShortageCost
```

`finalizedShortageCost` is passed in by callers; defaults to 0 so existing tests still pass. Add new tests covering shortage/surplus/draft/finalized/reversed scenarios (spec items 1–8).

### 3. Dashboard

- New query hook loads for selected date + tenant:
  - `stock_closings` rows for that date (all meat types), status + reversed_at + variance fields.
  - WAR per meat_type via `compute_closing_war` (batched).
- New cards (respect selected date, tenant, realtime): Closing Status, Shortage kg, Surplus kg, Shortage Cost, Surplus Est. Value, Expected Closing, Physical Closing.
- Warning banner logic: Draft / Missing (only if purchases|supplies|adjustments exist that date) / Finalized success line / Reversed line. Click → `/stock-closing?date=YYYY-MM-DD`.
- Profit card subtitle shows `Gross − General − Delivery − Shortage` breakdown; "Provisional" tag when draft.
- Current Stock: derived — pick latest finalized unreversed closing ≤ selectedDate per meat_type as baseline, add subsequent purchases − supplies + adj. Shared helper `src/lib/currentStock.ts`.

### 4. Inventory page

Reuse `currentStock.ts` helper so Inventory matches Dashboard exactly.

### 5. Reports Center

New report: **Daily Closing Variance**. Columns per spec §11. Summary cards + CSV/Excel/print export using existing patterns in `Reports.tsx`. Profit Reconciliation section uses updated `computeNetProfit` with `finalizedShortageCost`.

### 6. Daily Closing form (`StockClosing.tsx`)

- Live reconciliation table (Opening + Purchases − Supplies + PosAdj − NegAdj − Mortality = Expected; Physical − Expected = Variance).
- Reason lists switch by variance type (already done in Phase 1) — extend surplus list per spec §7.
- Client blocks Finalize when breakdown ≠ |variance| or "other" notes missing; server RPC re-validates.
- "Finalize" button calls `finalize_stock_closing` RPC.
- Finalized rows are read-only (already gated by status check); corrections via Reverse dialog.

### 7. Closing History

Add columns per spec §10, row detail dialog with full calc trail, extra filters (draft/finalized/reversed already present — add reason + date).

### 8. Realtime

Reuse existing per-mount channel pattern. New Dashboard channel subscribes to `stock_closings` + `stock_adjustments`; cleanup on unmount. No global channels.

### 9. Audit

Finalize RPC writes `closing_finalized` with before/after JSON. Reverse RPC already logs. Add `closing_reconciliation_failed` when server validation rejects finalize.

### 10. Tests

`src/lib/closingVariance.test.ts` + extend `netProfit.test.ts`: shortage 6kg, surplus 6kg, balanced, draft-does-not-lock, finalized shortage reduces net once, surplus no inflate, no double-count mortality/negAdj (spec items 1–8, 18). Idempotency (11–12) covered by RPC unit assertions.

### Files

**New**: `supabase/migrations/<ts>_phase2_closing.sql`, `src/lib/closingVariance.ts`, `src/lib/closingVariance.test.ts`, `src/lib/currentStock.ts`, `src/components/DashboardClosingCards.tsx`, `src/components/ClosingBanner.tsx`, `src/components/ClosingHistoryDetailDialog.tsx`.

**Modified**: `src/lib/netProfit.ts` + test, `src/pages/Dashboard.tsx`, `src/pages/Inventory.tsx`, `src/pages/Reports.tsx`, `src/pages/StockClosing.tsx`, `src/pages/ClosingHistory.tsx`, `src/integrations/supabase/types.ts` (auto-regenerated by migration).

### Out of scope (explicit)

- No changes to purchase / supply / recovery / expense / farm_payment / shop_recovery calculations.
- No changes to notification enum beyond what Phase 1 already did.
- No new `stock_opening_balances` table (derived approach).
- Surplus never increases profit — informational only.

### Verification

- `tsgo` typecheck, `bunx vitest run`, prod build.
- Manual reconciliation query comparing Dashboard values to raw SQL for one tenant on a shortage day + surplus day + balanced day.
- Confirm reversal blocked when later finalized closing exists.
