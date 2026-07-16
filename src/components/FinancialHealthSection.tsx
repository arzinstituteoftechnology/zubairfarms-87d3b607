import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fmtMoney } from "@/lib/constants";
import { computeShopBalances, totalReceivableFromShops } from "@/lib/shopReceivable";
import { computeFarmBalances, totalPayableToFarms } from "@/lib/farmPayable";
import { allocateAging } from "@/lib/shopAging";
import { printReport } from "@/lib/printReport";
import * as XLSX from "xlsx";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import {
  Wallet, Store, Scale, Percent, TrendingUp, TrendingDown,
  FileText, FileSpreadsheet, Printer, Download, Activity, ArrowRight,
  Crown, AlertOctagon,
} from "lucide-react";

type Period = "today" | "week" | "month" | "custom";

interface HealthKpis {
  receivable: number;
  payable: number;
  nwc: number;
  totalRecovery: number;
  totalSupplyValue: number;
  collectionPct: number;
}

interface TopShop { id: string; name: string; balance: number; ageDays: number }
interface TopFarm { id: string; name: string; balance: number; lastPurchase: string | null }
interface ChartPoint { date: string; label: string; receivable: number; payable: number; nwc: number }
interface TrendPoint { date: string; label: string; receivable: number; recovery: number; outstanding: number }

type HealthStatus = { label: string; tone: "excellent" | "good" | "warning" | "critical"; desc: string };

function computeHealth(receivable: number, payable: number): HealthStatus {
  if (receivable >= payable) return { label: "Excellent", tone: "excellent", desc: "Receivables cover payables." };
  const gap = payable > 0 ? (payable - receivable) / payable : 0;
  if (gap <= 0.10) return { label: "Good", tone: "good", desc: "Receivable within 10% of payable." };
  if (gap <= 0.25) return { label: "Warning", tone: "warning", desc: "Payable exceeds receivable by 10–25%." };
  return { label: "Critical", tone: "critical", desc: "Payable exceeds receivable by more than 25%." };
}

const TONE_BADGE: Record<HealthStatus["tone"], string> = {
  excellent: "bg-success/15 text-success border-success/30",
  good: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};

/** Health score 0–150 = receivable ÷ payable × 100 (200 max when payable is 0). */
function healthScore(receivable: number, payable: number): number {
  if (payable <= 0) return receivable > 0 ? 150 : 100;
  return Math.max(0, Math.min(150, (receivable / payable) * 100));
}

/** Semicircle gauge with 4 colored zones and a needle. Pure SVG — no lib. */
function HealthGauge({ score, status }: { score: number; status: HealthStatus }) {
  // Map 0..150 → angle 180°..0° (left → right).
  const angle = 180 - (Math.min(150, Math.max(0, score)) / 150) * 180;
  const rad = (angle * Math.PI) / 180;
  const cx = 110, cy = 100, r = 82;
  const nx = cx + Math.cos(rad) * (r - 8);
  const ny = cy - Math.sin(rad) * (r - 8);
  // Zones (percent → color). Boundaries in the 0..150 space, converted to fractions of the 180° arc.
  const zones = [
    { from: 0, to: 60, color: "hsl(var(--destructive))" },   // Critical
    { from: 60, to: 90, color: "hsl(24 95% 53%)" },          // Warning (orange)
    { from: 90, to: 100, color: "hsl(var(--primary))" },     // Good
    { from: 100, to: 150, color: "hsl(var(--success))" },    // Excellent
  ];
  const arc = (from: number, to: number) => {
    const a1 = ((150 - from) / 150) * 180;
    const a2 = ((150 - to) / 150) * 180;
    const p1 = { x: cx + Math.cos((a1 * Math.PI) / 180) * r, y: cy - Math.sin((a1 * Math.PI) / 180) * r };
    const p2 = { x: cx + Math.cos((a2 * Math.PI) / 180) * r, y: cy - Math.sin((a2 * Math.PI) / 180) * r };
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 1 ${p2.x} ${p2.y}`;
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 220 130" className="w-full max-w-[240px]">
        {zones.map((z, i) => (
          <path key={i} d={arc(z.from, z.to)} stroke={z.color} strokeWidth={16} fill="none" strokeLinecap="butt" />
        ))}
        {/* Tick labels */}
        <text x="18"  y="118" fontSize="9" fill="hsl(var(--muted-foreground))">Critical</text>
        <text x="70"  y="24"  fontSize="9" fill="hsl(var(--muted-foreground))">Warning</text>
        <text x="130" y="24"  fontSize="9" fill="hsl(var(--muted-foreground))">Good</text>
        <text x="172" y="118" fontSize="9" fill="hsl(var(--muted-foreground))">Excellent</text>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="hsl(var(--foreground))" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="hsl(var(--foreground))" />
        <circle cx={cx} cy={cy} r={3} fill="hsl(var(--background))" />
      </svg>
      <div className="text-center">
        <Badge className={`text-xs px-2.5 py-0.5 ${TONE_BADGE[status.tone]}`} variant="outline">{status.label}</Badge>
        <div className="text-[11px] text-muted-foreground mt-1">Coverage {score.toFixed(0)}%</div>
      </div>
    </div>
  );
}

const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000));

const ageColor = (age: number) =>
  age <= 30 ? "text-success" : age <= 60 ? "text-yellow-600" : age <= 90 ? "text-orange-600" : "text-destructive";

function Kpi({ icon: Icon, label, value, tone = "default", sub }: any) {
  const toneCls =
    tone === "success" ? "text-success" :
    tone === "danger" ? "text-destructive" :
    tone === "info" ? "text-primary" : "";
  const bg =
    tone === "success" ? "bg-success/10 text-success" :
    tone === "danger" ? "bg-destructive/10 text-destructive" :
    tone === "info" ? "bg-primary/10 text-primary" : "bg-primary/10 text-primary";
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={`mt-1 text-xl font-bold ${toneCls}`}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${bg}`}><Icon className="h-4 w-4" /></div>
      </div>
    </div>
  );
}

export function FinancialHealthSection({ asOf }: { asOf: string }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(format(subDays(new Date(asOf), 29), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(asOf);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<HealthKpis>({ receivable: 0, payable: 0, nwc: 0, totalRecovery: 0, totalSupplyValue: 0, collectionPct: 0 });
  const [topShops, setTopShops] = useState<TopShop[]>([]);
  const [topFarms, setTopFarms] = useState<TopFarm[]>([]);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [trend30, setTrend30] = useState<TrendPoint[]>([]);

  const range = useMemo(() => {
    const end = asOf;
    let start = asOf;
    if (period === "today") start = asOf;
    else if (period === "week") start = format(startOfWeek(new Date(asOf), { weekStartsOn: 1 }), "yyyy-MM-dd");
    else if (period === "month") start = format(startOfMonth(new Date(asOf)), "yyyy-MM-dd");
    else if (period === "custom") return { start: customFrom <= customTo ? customFrom : customTo, end: customFrom <= customTo ? customTo : customFrom };
    return { start, end };
  }, [period, asOf, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    const end = range.end;
    const start = range.start;

    const [
      { data: shops }, { data: farms },
      { data: supAll }, { data: shopLe }, { data: revRecov },
      { data: purAll }, { data: fpAll }, { data: supLe },
      { data: recPeriod }, { data: supPeriodVal },
      { data: rec30 }, { data: sup30 },
    ] = await Promise.all([
      supabase.from("shops").select("id, name, opening_balance").is("deleted_at", null),
      supabase.from("farms").select("id, name, opening_balance").is("deleted_at", null),
      supabase.from("supplies").select("shop_id, total_amount, reversed_at, supply_date").lte("supply_date", end),
      supabase.from("shop_ledger_entries").select("id, shop_id, entry_type, amount, entry_date, reversed_at, reversal_entry_id, original_entry_id").lte("entry_date", end),
      supabase.from("shop_recoveries").select("ledger_entry_id, reversed_at").not("reversed_at", "is", null),
      supabase.from("purchases").select("farm_id, total_amount, paid_amount, purchase_date, reversed_at").lte("purchase_date", end),
      supabase.from("farm_payments").select("farm_id, amount, payment_date, reversed_at").lte("payment_date", end),
      supabase.from("supplier_ledger_entries").select("farm_id, entry_type, amount, entry_date, reversed_at, original_entry_id").lte("entry_date", end),
      supabase.from("shop_recoveries").select("amount, recovery_date").gte("recovery_date", start).lte("recovery_date", end).is("reversed_at", null),
      supabase.from("supplies").select("total_amount, supply_date").gte("supply_date", start).lte("supply_date", end).is("reversed_at", null),
      supabase.from("shop_recoveries").select("amount, recovery_date").gte("recovery_date", format(subDays(new Date(end), 29), "yyyy-MM-dd")).lte("recovery_date", end).is("reversed_at", null),
      supabase.from("supplies").select("total_amount, supply_date").gte("supply_date", format(subDays(new Date(end), 29), "yyyy-MM-dd")).lte("supply_date", end).is("reversed_at", null),
    ]);

    // Current position (as-of end)
    const shopBalances = computeShopBalances(shops as any, supAll as any, shopLe as any, revRecov as any, end);
    const farmBalances = computeFarmBalances(farms as any, purAll as any, fpAll as any, supLe as any, end);
    const receivable = totalReceivableFromShops(shopBalances);
    const payable = totalPayableToFarms(farmBalances);

    const totalRecovery = (recPeriod ?? []).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
    const totalSupplyValue = (supPeriodVal ?? []).reduce((a, x: any) => a + Number(x.total_amount ?? 0), 0);
    const collectionPct = totalSupplyValue > 0 ? Math.min(200, (totalRecovery / totalSupplyValue) * 100) : 0;

    setKpis({ receivable, payable, nwc: receivable - payable, totalRecovery, totalSupplyValue, collectionPct });

    // Top 5 shops: highest outstanding, with weighted-avg age from aging FIFO
    const revRecovIds = new Set((revRecov ?? []).map((x: any) => x.ledger_entry_id).filter(Boolean));
    const debitsByShop: Record<string, { date: string; amount: number }[]> = {};
    const creditsByShop: Record<string, { date: string; amount: number }[]> = {};
    (shops ?? []).forEach((s: any) => {
      debitsByShop[s.id] = [];
      creditsByShop[s.id] = [];
      const ob = Number(s.opening_balance ?? 0);
      if (ob > 0) debitsByShop[s.id].push({ date: "1970-01-01", amount: ob });
    });
    (supAll ?? []).forEach((x: any) => {
      if (x.reversed_at || (x.supply_date && x.supply_date > end)) return;
      (debitsByShop[x.shop_id] ??= []).push({ date: x.supply_date || "1970-01-01", amount: Number(x.total_amount ?? 0) });
    });
    (shopLe ?? []).forEach((x: any) => {
      if (x.reversed_at || x.reversal_entry_id || x.original_entry_id) return;
      if (String(x.entry_type).startsWith("reversed_")) return;
      if (x.entry_type === "recovery" && revRecovIds.has(x.id)) return;
      const d = x.entry_date || "1970-01-01";
      const amt = Number(x.amount ?? 0);
      const b = (debitsByShop[x.shop_id] ??= []);
      const c = (creditsByShop[x.shop_id] ??= []);
      if (x.entry_type === "opening_balance") {
        // Replace the auto opening slice with ledger value; simplest: append.
        if (amt !== 0) b.push({ date: d, amount: amt });
      } else if (x.entry_type === "manual_supply" || x.entry_type === "adjustment_increase") {
        b.push({ date: d, amount: amt });
      } else if (x.entry_type === "adjustment_decrease" || x.entry_type === "manual_payment" || x.entry_type === "recovery") {
        c.push({ date: d, amount: amt });
      }
    });
    const shopNameMap = new Map((shops ?? []).map((s: any) => [s.id, s.name]));
    const top5 = shopBalances
      .filter(b => b.balance > 0.009)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map<TopShop>((b) => {
        const aging = allocateAging(debitsByShop[b.id] ?? [], creditsByShop[b.id] ?? [], end);
        return { id: b.id, name: shopNameMap.get(b.id) ?? "—", balance: b.balance, ageDays: Math.round(aging.avgAgeDays) };
      });
    setTopShops(top5);

    // Top 5 farms to pay
    const farmNameMap = new Map((farms ?? []).map((f: any) => [f.id, f.name]));
    const top5Farms = farmBalances
      .filter(b => b.balance > 0.009)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map<TopFarm>((b) => ({ id: b.id, name: farmNameMap.get(b.id) ?? "—", balance: b.balance, lastPurchase: b.lastPurchaseDate }));
    setTopFarms(top5Farms);

    // Chart: daily receivable/payable/nwc across [start,end], capped to 60 points
    const dayCount = Math.min(60, daysBetween(start, end) + 1);
    const stepMs = 86_400_000;
    const dates: string[] = [];
    const anchor = new Date(end + "T00:00:00Z").getTime();
    for (let i = dayCount - 1; i >= 0; i--) {
      dates.push(new Date(anchor - i * stepMs).toISOString().slice(0, 10));
    }
    const points: ChartPoint[] = dates.map((d) => {
      const r = totalReceivableFromShops(computeShopBalances(shops as any, supAll as any, shopLe as any, revRecov as any, d));
      const p = totalPayableToFarms(computeFarmBalances(farms as any, purAll as any, fpAll as any, supLe as any, d));
      return { date: d, label: format(new Date(d + "T00:00:00Z"), dayCount > 14 ? "MMM d" : "EEE d"), receivable: Math.round(r), payable: Math.round(p), nwc: Math.round(r - p) };
    });
    setChart(points);

    // 30-day collection trend (independent of period selector)
    const trendPoints: TrendPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = format(subDays(new Date(end), i), "yyyy-MM-dd");
      const r = totalReceivableFromShops(computeShopBalances(shops as any, supAll as any, shopLe as any, revRecov as any, d));
      const recovery = (rec30 ?? []).filter((x: any) => x.recovery_date === d).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
      const supplied = (sup30 ?? []).filter((x: any) => x.supply_date === d).reduce((a, x: any) => a + Number(x.total_amount ?? 0), 0);
      trendPoints.push({ date: d, label: format(new Date(d + "T00:00:00Z"), "MMM d"), receivable: Math.round(supplied), recovery: Math.round(recovery), outstanding: Math.round(r) });
    }
    setTrend30(trendPoints);

    setLoading(false);
  }, [range.start, range.end]);

  useEffect(() => { load(); }, [load]);

  // Realtime — refresh on the affected KPIs only
  useEffect(() => {
    const ch = supabase.channel("fin-health-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "supplies" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_recoveries" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "farm_payments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_ledger_entries" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "supplier_ledger_entries" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const health = computeHealth(kpis.receivable, kpis.payable);
  const score = healthScore(kpis.receivable, kpis.payable);
  const largestDebtor = topShops[0] ?? null;
  const largestCreditor = topFarms[0] ?? null;

  const exportRows = () => {
    const summary = [
      { Section: "Cash Flow", Metric: "Receivable from Shops", Value: kpis.receivable },
      { Section: "Cash Flow", Metric: "Payable to Farms", Value: kpis.payable },
      { Section: "Cash Flow", Metric: "Net Working Capital", Value: kpis.nwc },
      { Section: "Cash Flow", Metric: "Cash Collection %", Value: Number(kpis.collectionPct.toFixed(2)) },
      { Section: "Cash Flow", Metric: "Total Recovery (period)", Value: kpis.totalRecovery },
      { Section: "Cash Flow", Metric: "Total Supply Value (period)", Value: kpis.totalSupplyValue },
      { Section: "Health", Metric: "Status", Value: health.label },
      { Section: "Projection", Metric: "Expected Cash In", Value: kpis.receivable },
      { Section: "Projection", Metric: "Expected Cash Out", Value: kpis.payable },
      { Section: "Projection", Metric: "Net Expected Cash", Value: kpis.nwc },
    ];
    const shopsRows = topShops.map(s => ({ Shop: s.name, Outstanding: s.balance, "Days Outstanding": s.ageDays }));
    const farmsRows = topFarms.map(f => ({ Farm: f.name, "Outstanding Payable": f.balance, "Last Purchase": f.lastPurchase ?? "—" }));
    return { summary, shopsRows, farmsRows };
  };

  const doExcel = () => {
    const { summary, shopsRows, farmsRows } = exportRows();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopsRows), "Top Shops");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(farmsRows), "Top Farms");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chart), "Trend");
    XLSX.writeFile(wb, `financial-health-${range.start}_to_${range.end}.xlsx`);
  };

  const doCsv = () => {
    const { summary, shopsRows, farmsRows } = exportRows();
    const lines: string[] = [];
    lines.push("Section,Metric,Value");
    summary.forEach(r => lines.push(`${r.Section},${r.Metric},${r.Value}`));
    lines.push("");
    lines.push("Top Outstanding Shops");
    lines.push("Shop,Outstanding,Days Outstanding");
    shopsRows.forEach(r => lines.push(`${r.Shop},${r.Outstanding},${r["Days Outstanding"]}`));
    lines.push("");
    lines.push("Top Farms to Pay");
    lines.push("Farm,Outstanding Payable,Last Purchase");
    farmsRows.forEach(r => lines.push(`${r.Farm},${r["Outstanding Payable"]},${r["Last Purchase"]}`));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `financial-health-${range.start}_to_${range.end}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const doPrint = () => {
    printReport({
      title: "Financial Health Summary",
      subtitle: `Health: ${health.label} — ${health.desc}`,
      dateLabel: `${range.start} → ${range.end}`,
      columns: [
        { label: "Metric", value: (r: any) => r.metric },
        { label: "Value", value: (r: any) => r.value, align: "right" },
      ],
      rows: [
        { metric: "Receivable from Shops", value: fmtMoney(kpis.receivable) },
        { metric: "Payable to Farms", value: fmtMoney(kpis.payable) },
        { metric: "Net Working Capital", value: fmtMoney(kpis.nwc) },
        { metric: "Cash Collection %", value: `${kpis.collectionPct.toFixed(1)}%` },
        { metric: "Total Recovery (period)", value: fmtMoney(kpis.totalRecovery) },
        { metric: "Total Supply Value (period)", value: fmtMoney(kpis.totalSupplyValue) },
        { metric: "Expected Cash In", value: fmtMoney(kpis.receivable) },
        { metric: "Expected Cash Out", value: fmtMoney(kpis.payable) },
        { metric: "Net Expected Cash", value: fmtMoney(kpis.nwc) },
      ],
      totals: [
        { label: "Top Outstanding Shops", value: topShops.map(s => `${s.name}: ${fmtMoney(s.balance)} (${s.ageDays}d)`).join("  •  ") || "—" },
        { label: "Top Farms to Pay", value: topFarms.map(f => `${f.name}: ${fmtMoney(f.balance)}`).join("  •  ") || "—" },
      ],
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Financial Health Summary
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Period: {range.start} → {range.end}{loading ? " • loading…" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            {(["today", "week", "month", "custom"] as Period[]).map((p) => (
              <button key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs capitalize transition-colors ${period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >{p}</button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1">
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="force-ltr w-[150px] h-8" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="force-ltr w-[150px] h-8" />
            </div>
          )}
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={doPrint} title="Print / PDF"><Printer className="h-3.5 w-3.5" /></Button>
            <Button variant="outline" size="sm" onClick={doExcel} title="Excel"><FileSpreadsheet className="h-3.5 w-3.5" /></Button>
            <Button variant="outline" size="sm" onClick={doCsv} title="CSV"><Download className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cash Flow Summary */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Cash Flow Summary</div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Store} label="Receivable from Shops" value={fmtMoney(kpis.receivable)} tone="info" />
            <Kpi icon={Wallet} label="Payable to Farms" value={fmtMoney(kpis.payable)} tone="danger" />
            <Kpi icon={Scale} label="Net Working Capital" value={fmtMoney(kpis.nwc)} tone={kpis.nwc > 0 ? "success" : kpis.nwc < 0 ? "danger" : "default"} />
            <Kpi icon={Percent} label="Cash Collection %" value={`${kpis.collectionPct.toFixed(1)}%`} tone={kpis.collectionPct >= 80 ? "success" : kpis.collectionPct >= 50 ? "info" : "danger"} sub={`Recovery ${fmtMoney(kpis.totalRecovery)} / Supply ${fmtMoney(kpis.totalSupplyValue)}`} />
          </div>
        </div>

        {/* Health gauge + Largest Debtor/Creditor + Projection */}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Financial Health</div>
            <HealthGauge score={score} status={health} />
            <div className="text-[11px] text-muted-foreground mt-2 text-center">{health.desc}</div>
          </div>
          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-primary" />Largest Debtor</div>
              {largestDebtor ? (
                <button onClick={() => navigate(`/shop-ledger?shop=${largestDebtor.id}`)} className="mt-1 text-left w-full group">
                  <div className="font-semibold group-hover:text-primary transition-colors">{largestDebtor.name}</div>
                  <div className="text-lg font-bold text-primary">{fmtMoney(largestDebtor.balance)}</div>
                  <div className="text-[11px] text-muted-foreground">Avg age {largestDebtor.ageDays}d — click to open ledger</div>
                </button>
              ) : <div className="text-xs text-muted-foreground mt-1">No outstanding shops.</div>}
            </div>
            <div className="border-t pt-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><AlertOctagon className="h-3.5 w-3.5 text-destructive" />Largest Creditor</div>
              {largestCreditor ? (
                <button onClick={() => navigate("/suppliers")} className="mt-1 text-left w-full group">
                  <div className="font-semibold group-hover:text-destructive transition-colors">{largestCreditor.name}</div>
                  <div className="text-lg font-bold text-destructive">{fmtMoney(largestCreditor.balance)}</div>
                  <div className="text-[11px] text-muted-foreground">Last purchase {largestCreditor.lastPurchase ?? "—"} — pay first</div>
                </button>
              ) : <div className="text-xs text-muted-foreground mt-1">No pending farm payables.</div>}
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Cash Projection</div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-success" />Expected In</span>
                <span className="font-semibold text-success">{fmtMoney(kpis.receivable)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-destructive" />Expected Out</span>
                <span className="font-semibold text-destructive">{fmtMoney(kpis.payable)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-xs font-medium">Net Expected</span>
                <span className={`font-bold text-base ${kpis.nwc > 0 ? "text-success" : kpis.nwc < 0 ? "text-destructive" : ""}`}>{fmtMoney(kpis.nwc)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Top lists */}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border">
            <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Top 5 Outstanding Shops</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => navigate("/shop-ledger")}>Open <ArrowRight className="h-3 w-3 ml-1" /></Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 px-4 font-medium">Shop</th>
                  <th className="py-2 px-4 font-medium text-right">Outstanding</th>
                  <th className="py-2 px-4 font-medium text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {topShops.length === 0 ? (
                  <tr><td colSpan={3} className="py-4 px-4 text-center text-muted-foreground text-xs">No outstanding shops.</td></tr>
                ) : topShops.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/40 cursor-pointer" onClick={() => navigate(`/shop-ledger?shop=${s.id}`)}>
                    <td className="py-2 px-4 font-medium">{s.name}</td>
                    <td className="py-2 px-4 text-right">{fmtMoney(s.balance)}</td>
                    <td className={`py-2 px-4 text-right font-semibold ${ageColor(s.ageDays)}`}>{s.ageDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border">
            <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Top 5 Farms to Pay</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => navigate("/suppliers")}>Open <ArrowRight className="h-3 w-3 ml-1" /></Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 px-4 font-medium">Farm</th>
                  <th className="py-2 px-4 font-medium text-right">Outstanding</th>
                  <th className="py-2 px-4 font-medium text-right">Last Purchase</th>
                </tr>
              </thead>
              <tbody>
                {topFarms.length === 0 ? (
                  <tr><td colSpan={3} className="py-4 px-4 text-center text-muted-foreground text-xs">No pending farm payables.</td></tr>
                ) : topFarms.map((f) => (
                  <tr key={f.id} className="border-b last:border-b-0 hover:bg-muted/40 cursor-pointer" onClick={() => navigate("/suppliers")}>
                    <td className="py-2 px-4 font-medium">{f.name}</td>
                    <td className="py-2 px-4 text-right text-destructive font-semibold">{fmtMoney(f.balance)}</td>
                    <td className="py-2 px-4 text-right text-xs text-muted-foreground">{f.lastPurchase ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trend chart */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Receivable vs Payable vs Net Working Capital</div>
          <ChartContainer
            config={{
              receivable: { label: "Receivable", color: "hsl(var(--primary))" },
              payable: { label: "Payable", color: "hsl(var(--destructive))" },
              nwc: { label: "Net Working Capital", color: "hsl(var(--success))" },
            }}
            className="h-[280px] w-full force-ltr"
          >
            <LineChart data={chart} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line type="monotone" dataKey="receivable" stroke="var(--color-receivable)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="payable" stroke="var(--color-payable)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="nwc" stroke="var(--color-nwc)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default FinancialHealthSection;