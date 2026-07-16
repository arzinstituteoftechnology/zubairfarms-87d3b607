# Enterprise Receivable Analytics — Plan

## 1. New KPI: Net Working Capital
- Add `NET WORKING CAPITAL = receivableFromShops − payableToFarms` to Dashboard KPI grid, placed after "Receivable from Shops".
- Colors: positive → success, negative → destructive, zero → default. Subtitle: *Net Cash Position*.
- Uses existing `kpi.receivableFromShops` and `kpi.payableToFarms` (already realtime and date-aware — no new fetch needed).
- Click → navigate to `/reports` (existing Financial Summary Report). Add anchor hash `#financial-summary` (best-effort scroll).

## 2. Receivable Breakdown Dialog
- New component `src/components/ShopReceivableDialog.tsx` opened when user clicks "Receivable from Shops" (replacing the current direct navigation; keep a secondary "Open Shop Ledger" button inside the dialog for full-page view).
- Reuses `computeShopBalances` from `src/lib/shopReceivable.ts`; augments per shop with:
  - `lastSupplyDate` — max(`supplies.supply_date`) where `reversed_at IS NULL`
  - `lastRecoveryDate` — max(`shop_ledger_entries.entry_date`) for active `recovery` / `manual_payment` rows
  - `adjustments` — manual_supply + adjustment_increase − adjustment_decrease
- Table columns: Shop, Opening, Supplies, Recoveries, Adjustments, **Outstanding** (bold), Last Supply, Last Recovery.
- Sorted by Outstanding DESC. Search box (name), 10-per-page pagination (reuse existing table primitives / simple local state).

## 3. Aging Analysis (inside the dialog)
- Per shop, allocate outstanding balance to age buckets using FIFO against active (non-reversed) supplies + non-recovery ledger debits, ordered by date, offset by cumulative active recoveries.
- Buckets vs `selectedDate`: 0–30, 31–60, 61–90, 90+ days.
- Show totals row with amount + % of grand receivable, colored badges: 0–30 green, 31–60 yellow, 61–90 orange, 90+ red.
- Per-row: small stacked bar or 4 mini-cells with the same color coding.

## 4. Collection Summary strip (dialog header)
- Total Shops, Shops with Outstanding, Shops Fully Paid.
- Largest Outstanding Shop (name + amount, clickable → `/shop-ledger?shop=<id>`).
- Oldest Outstanding Invoice: earliest active supply/debit date still unpaid (from FIFO calc above).
- Average Collection Days: mean age (weighted by amount) of outstanding rows.
- Collection Rate %: `Σ active recoveries / (Σ active supplies + opening + manual_supply + adj_inc − adj_dec)` clamped 0–100.

## 5. Reconciliation Line
- Dashboard KPI area shows a small line under the receivable card:
  `Receivable = Σ Shop Ledger balances — Verified ✓` when equal (within 0.01), else red warning with delta value.
- Compares dashboard total to a re-computation from same data (sanity check that math is deterministic; also flags rounding drift).

## 6. Click Actions
- Receivable KPI card → opens the new dialog (breakdown).
- "Open full Shop Ledger" button inside dialog → `/shop-ledger`.
- Net Working Capital card → `/reports`.
- Largest Outstanding row/button → `/shop-ledger?shop=<id>` (ShopLedger already reads the row via search; deep-link is optional visual, existing page will still list all shops — no changes to ShopLedger required).

## 7. Export
- Dialog toolbar buttons: **CSV**, **Excel**, **PDF**, **Print**.
- CSV: build string in-browser, download via Blob.
- Excel: reuse existing `xlsx`/`sheetjs` if present; otherwise export `.xls` HTML-table fallback (check `package.json`).
- PDF/Print: reuse `src/lib/printReport.ts` helper (opens print window with styled HTML — user prints to PDF).

## 8. Security & Realtime
- All queries go through the existing tenant-scoped Supabase client (RLS enforced). No new endpoints.
- Realtime: dialog subscribes to `supplies`, `shop_ledger_entries`, `shop_recoveries`, `shops` on a single channel with a unique name; unsubscribes on close. Dashboard's existing subscription already covers KPI refresh — no changes there.

## 10. Validation / Tests
- Extend `src/lib/shopReceivable.test.ts` with:
  - Aging bucket allocation (FIFO offset) test.
  - Collection Rate math (edge: 0 supplies).
  - Net Working Capital sign (positive/negative/zero).
- Run `bunx vitest run` + `bunx tsgo --noEmit`.
- SQL reconciliation: run one query totalling positive shop balances against dashboard total.

## Files
- **New**: `src/components/ShopReceivableDialog.tsx`, extra cases in `src/lib/shopReceivable.test.ts`, helper `src/lib/shopAging.ts` (+ test).
- **Edit**: `src/pages/Dashboard.tsx` — add NWC card, reconciliation line, wire dialog to KPI card.
- **No changes** to accounting/business logic, ShopLedger page, or existing Payable calculation.

## Technical notes
- Aging FIFO: sort active debits (supplies + manual_supply + adjustment_increase + opening) ascending by date; subtract active credits (recovery + manual_payment + adjustment_decrease) from oldest first; remaining unpaid slices are the aged outstanding pieces, dated at their original entry.
- Everything as-of `selectedDate` from `useLedgerDate`.
- Charts kept minimal (no new chart lib) — colored badges + progress bars only.
