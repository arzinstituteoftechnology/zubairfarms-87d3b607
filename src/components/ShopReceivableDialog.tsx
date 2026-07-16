import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney } from "@/lib/constants";
import { computeShopBalances } from "@/lib/shopReceivable";
import { allocateAging, collectionRate, type AgingResult } from "@/lib/shopAging";
import { printReport } from "@/lib/printReport";
import * as XLSX from "xlsx";
import { Search, FileText, FileSpreadsheet, Printer, ExternalLink } from "lucide-react";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; asOf: string };

interface ShopRow {
  id: string;
  name: string;
  opening: number;
  supplies: number;
  recoveries: number;
  adjustments: number;
  balance: number;
  lastSupplyDate: string | null;
  lastRecoveryDate: string | null;
  aging: AgingResult;
}

const PAGE_SIZE = 10;
const AGING_COLORS: Record<string, string> = {
  "0-30": "bg-success/15 text-success border-success/30",
  "31-60": "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  "61-90": "bg-orange-500/15 text-orange-600 border-orange-500/30",
  "90+": "bg-destructive/15 text-destructive border-destructive/30",
};

export function ShopReceivableDialog({ open, onOpenChange, asOf }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    const [{ data: shops }, { data: su }, { data: le }, { data: rr }] = await Promise.all([
      supabase.from("shops").select("id, name, opening_balance, created_at").is("deleted_at", null).order("name"),
      supabase.from("supplies").select("shop_id, total_amount, reversed_at, supply_date").lte("supply_date", asOf),
      supabase.from("shop_ledger_entries").select("id, shop_id, entry_type, amount, entry_date, reversed_at, reversal_entry_id, original_entry_id").lte("entry_date", asOf),
      supabase.from("shop_recoveries").select("ledger_entry_id, reversed_at").not("reversed_at", "is", null),
    ]);
    const balances = computeShopBalances(shops as any, su as any, le as any, rr as any, asOf);
    const bMap = new Map(balances.map(b => [b.id, b]));
    const revRecovIds = new Set((rr ?? []).map((x: any) => x.ledger_entry_id).filter(Boolean));

    // Per-shop last dates and aging debit/credit slices
    const perShop: Record<string, { lastSup: string | null; lastRec: string | null; debits: {date:string;amount:number}[]; credits: {date:string;amount:number}[] }> = {};
    (shops ?? []).forEach((s: any) => {
      perShop[s.id] = { lastSup: null, lastRec: null, debits: [], credits: [] };
    });
    (su ?? []).forEach((x: any) => {
      const p = perShop[x.shop_id]; if (!p || x.reversed_at) return;
      if (!p.lastSup || x.supply_date > p.lastSup) p.lastSup = x.supply_date;
      p.debits.push({ date: x.supply_date, amount: Number(x.total_amount || 0) });
    });
    (le ?? []).forEach((x: any) => {
      const p = perShop[x.shop_id]; if (!p) return;
      if (x.reversed_at || x.reversal_entry_id || x.original_entry_id) return;
      if (x.entry_type === "recovery" && revRecovIds.has(x.id)) return;
      if (String(x.entry_type).startsWith("reversed_")) return;
      const d = x.entry_date || asOf;
      const amt = Number(x.amount || 0);
      switch (x.entry_type) {
        case "manual_supply":
        case "adjustment_increase":
          p.debits.push({ date: d, amount: amt }); break;
        case "recovery":
        case "manual_payment":
          p.credits.push({ date: d, amount: amt });
          if (!p.lastRec || d > p.lastRec) p.lastRec = d;
          break;
        case "adjustment_decrease":
          p.credits.push({ date: d, amount: amt }); break;
      }
    });

    const out: ShopRow[] = (shops ?? []).map((s: any) => {
      const bal = bMap.get(s.id);
      const p = perShop[s.id];
      // Include opening as an aged debit dated at shop creation (fallback to earliest supply or asOf)
      const openingAmt = bal?.opening ?? 0;
      const openingDate = openingAmt > 0
        ? (s.created_at ? String(s.created_at).slice(0, 10) : (p.debits[0]?.date ?? asOf))
        : asOf;
      const debits = openingAmt > 0 ? [{ date: openingDate, amount: openingAmt }, ...p.debits] : p.debits;
      const aging = allocateAging(debits, p.credits, asOf);
      return {
        id: s.id, name: s.name,
        opening: bal?.opening ?? 0,
        supplies: bal?.supplied ?? 0,
        recoveries: bal?.paid ?? 0,
        adjustments: bal?.adj ?? 0,
        balance: bal?.balance ?? 0,
        lastSupplyDate: p.lastSup,
        lastRecoveryDate: p.lastRec,
        aging,
      };
    }).sort((a, b) => b.balance - a.balance);
    setRows(out);
    setLoading(false);
  };

  useEffect(() => { if (open) { setPage(1); void load(); } }, [open, asOf]);

  useEffect(() => {
    if (!open) return;
    const ch = supabase.channel("shop-receivable-dialog-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "supplies" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_ledger_entries" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_recoveries" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "shops" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, asOf]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? rows.filter(r => r.name.toLowerCase().includes(term)) : rows;
  }, [rows, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const summary = useMemo(() => {
    const outstanding = rows.filter(r => r.balance > 0.005);
    const totalReceivable = outstanding.reduce((a, r) => a + r.balance, 0);
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
    let weightedAgeNum = 0, weightedAgeDen = 0;
    let oldest: string | null = null;
    let largest = outstanding[0];
    outstanding.forEach(r => {
      buckets["0-30"] += r.aging.buckets["0-30"];
      buckets["31-60"] += r.aging.buckets["31-60"];
      buckets["61-90"] += r.aging.buckets["61-90"];
      buckets["90+"] += r.aging.buckets["90+"];
      weightedAgeNum += r.aging.avgAgeDays * r.aging.total;
      weightedAgeDen += r.aging.total;
      if (r.aging.oldestUnpaidDate && (!oldest || r.aging.oldestUnpaidDate < oldest)) oldest = r.aging.oldestUnpaidDate;
      if (!largest || r.balance > largest.balance) largest = r;
    });
    const totalDebits = rows.reduce((a, r) => a + r.opening + r.supplies + Math.max(0, r.adjustments), 0);
    const totalCredits = rows.reduce((a, r) => a + r.recoveries + Math.max(0, -r.adjustments), 0);
    return {
      totalShops: rows.length,
      withOutstanding: outstanding.length,
      fullyPaid: rows.length - outstanding.length,
      totalReceivable,
      buckets,
      largest,
      oldest,
      avgCollectionDays: weightedAgeDen > 0 ? weightedAgeNum / weightedAgeDen : 0,
      collectionRatePct: collectionRate(totalDebits, totalCredits),
    };
  }, [rows]);

  const exportCsv = () => {
    const header = ["Shop","Opening","Supplies","Recoveries","Adjustments","Outstanding","Last Supply","Last Recovery","0-30","31-60","61-90","90+"];
    const lines = [header.join(",")];
    filtered.forEach(r => lines.push([
      `"${r.name.replace(/"/g,'""')}"`, r.opening, r.supplies, r.recoveries, r.adjustments, r.balance,
      r.lastSupplyDate ?? "", r.lastRecoveryDate ?? "",
      r.aging.buckets["0-30"], r.aging.buckets["31-60"], r.aging.buckets["61-90"], r.aging.buckets["90+"],
    ].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `receivable-from-shops-${asOf}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const exportXlsx = () => {
    const data = filtered.map(r => ({
      Shop: r.name, Opening: r.opening, Supplies: r.supplies, Recoveries: r.recoveries,
      Adjustments: r.adjustments, Outstanding: r.balance,
      "Last Supply": r.lastSupplyDate ?? "", "Last Recovery": r.lastRecoveryDate ?? "",
      "0-30": r.aging.buckets["0-30"], "31-60": r.aging.buckets["31-60"],
      "61-90": r.aging.buckets["61-90"], "90+": r.aging.buckets["90+"],
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Receivable");
    XLSX.writeFile(wb, `receivable-from-shops-${asOf}.xlsx`);
  };

  const printPdf = () => {
    printReport({
      title: "Receivable from Shops",
      subtitle: `Total outstanding: ${fmtMoney(summary.totalReceivable)}`,
      dateLabel: `As of ${asOf}`,
      orientation: "landscape",
      columns: [
        { label: "Shop", value: (r: ShopRow) => r.name },
        { label: "Opening", value: (r: ShopRow) => fmtMoney(r.opening), align: "right" },
        { label: "Supplies", value: (r: ShopRow) => fmtMoney(r.supplies), align: "right" },
        { label: "Recoveries", value: (r: ShopRow) => fmtMoney(r.recoveries), align: "right" },
        { label: "Adjustments", value: (r: ShopRow) => fmtMoney(r.adjustments), align: "right" },
        { label: "Outstanding", value: (r: ShopRow) => fmtMoney(r.balance), align: "right" },
        { label: "Last Supply", value: (r: ShopRow) => r.lastSupplyDate ?? "—" },
        { label: "Last Recovery", value: (r: ShopRow) => r.lastRecoveryDate ?? "—" },
      ],
      rows: filtered,
      totals: [
        { label: "Shops with outstanding", value: String(summary.withOutstanding) },
        { label: "Total receivable", value: fmtMoney(summary.totalReceivable) },
      ],
      footer: `Generated ${new Date().toLocaleString()}`,
    });
  };

  const goShop = (id: string) => { onOpenChange(false); navigate(`/shop-ledger?shop=${id}`); };
  const goLedger = () => { onOpenChange(false); navigate("/shop-ledger"); };

  const bucketPct = (v: number) => summary.totalReceivable > 0 ? (v / summary.totalReceivable) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receivable from Shops — as of {asOf}</DialogTitle>
        </DialogHeader>

        {/* Collection summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 text-sm">
          <SummaryCell label="Total Shops" value={String(summary.totalShops)} />
          <SummaryCell label="With Outstanding" value={String(summary.withOutstanding)} />
          <SummaryCell label="Fully Paid" value={String(summary.fullyPaid)} tone="success" />
          <SummaryCell
            label="Largest Outstanding"
            value={summary.largest ? `${summary.largest.name}` : "—"}
            sub={summary.largest ? fmtMoney(summary.largest.balance) : ""}
            onClick={summary.largest ? () => goShop(summary.largest!.id) : undefined}
          />
          <SummaryCell label="Oldest Unpaid" value={summary.oldest ?? "—"} />
          <SummaryCell label="Avg Collection Days" value={summary.avgCollectionDays.toFixed(1)} />
          <SummaryCell label="Collection Rate" value={`${summary.collectionRatePct.toFixed(1)}%`} tone="success" />
        </div>

        {/* Aging totals */}
        <div className="grid grid-cols-4 gap-2 mt-2">
          {(["0-30","31-60","61-90","90+"] as const).map(b => (
            <div key={b} className={`rounded-md border p-2 ${AGING_COLORS[b]}`}>
              <div className="text-xs uppercase tracking-wider opacity-80">{b} days</div>
              <div className="font-bold text-lg">{fmtMoney(summary.buckets[b])}</div>
              <div className="text-xs opacity-80">{bucketPct(summary.buckets[b]).toFixed(1)}% of total</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between mt-3">
          <div className="relative w-full sm:max-w-xs">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search shop…" className="pl-8" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={exportCsv}><FileText className="h-4 w-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
            <Button variant="outline" size="sm" onClick={printPdf}><Printer className="h-4 w-4 mr-1" />PDF / Print</Button>
            <Button size="sm" onClick={goLedger}><ExternalLink className="h-4 w-4 mr-1" />Open Shop Ledger</Button>
          </div>
        </div>

        {/* Table */}
        <div className="border rounded-md overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Shop</th>
                <th className="p-2 text-right">Opening</th>
                <th className="p-2 text-right">Supplies</th>
                <th className="p-2 text-right">Recoveries</th>
                <th className="p-2 text-right">Adj.</th>
                <th className="p-2 text-right">Outstanding</th>
                <th className="p-2">Last Supply</th>
                <th className="p-2">Last Recovery</th>
                <th className="p-2">Aging</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!loading && pageRows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No records.</td></tr>}
              {!loading && pageRows.map(r => (
                <tr key={r.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => goShop(r.id)}>
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2 text-right">{fmtMoney(r.opening)}</td>
                  <td className="p-2 text-right">{fmtMoney(r.supplies)}</td>
                  <td className="p-2 text-right">{fmtMoney(r.recoveries)}</td>
                  <td className="p-2 text-right">{fmtMoney(r.adjustments)}</td>
                  <td className={`p-2 text-right font-bold ${r.balance > 0 ? "text-destructive" : r.balance < 0 ? "text-success" : ""}`}>{fmtMoney(r.balance)}</td>
                  <td className="p-2">{r.lastSupplyDate ?? "—"}</td>
                  <td className="p-2">{r.lastRecoveryDate ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex gap-1 flex-wrap">
                      {(["0-30","31-60","61-90","90+"] as const).map(b => r.aging.buckets[b] > 0 && (
                        <Badge key={b} variant="outline" className={AGING_COLORS[b]}>{b}: {fmtMoney(r.aging.buckets[b])}</Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
          <div>{filtered.length} shop(s)</div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <span>Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SummaryCell = ({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: "success"; onClick?: () => void }) => (
  <div className={`rounded-md border p-2 ${onClick ? "cursor-pointer hover:border-primary" : ""}`} onClick={onClick}>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`font-semibold truncate ${tone === "success" ? "text-success" : ""}`}>{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);