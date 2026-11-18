import { useEffect, useMemo, useState } from "react";
import { LoadingValue } from "@/components/LoadingValue";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEAT_TYPES, fmtKg, fmtMoney } from "@/lib/constants";
import { format, subDays, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";
import { Printer, Skull } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";

type Row = {
  id: string;
  adjustment_date: string;
  meat_type: string;
  quantity_kg: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  reversed_at: string | null;
  closing_id: string | null;
  farm_id: string | null;
  shop_id: string | null;
  bird_count: number | null;
  system_stock?: number | null;
  physical_stock?: number | null;
  creator_name?: string | null;
  farm_name?: string | null;
  shop_name?: string | null;
  rate?: number;
  cost?: number;
};

type MonthRow = { meat_type: string; deadKg: number; cost: number; purchasedKg: number; pct: number };

const MortalityRegister = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);
  const [meatType, setMeatType] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [analyticsMonth, setAnalyticsMonth] = useState(format(new Date(), "yyyy-MM"));
  const [monthly, setMonthly] = useState<MonthRow[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState({ deadKg: 0, cost: 0, purchasedKg: 0, avgDaily: 0, pct: 0 });

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase
        .from("stock_adjustments")
        .select("id, adjustment_date, meat_type, quantity_kg, notes, created_by, created_at, reversed_at, closing_id, farm_id, shop_id, bird_count")
        .eq("reason", "mortality")
        .is("original_adjustment_id", null)
        .lt("quantity_kg", 0)
        .gte("adjustment_date", from).lte("adjustment_date", to)
        .order("adjustment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (meatType !== "all") q = q.eq("meat_type", meatType);
      const { data } = await q;
      const list = (data ?? []) as Row[];

      const closingIds = Array.from(new Set(list.map((r) => r.closing_id).filter(Boolean))) as string[];
      if (closingIds.length) {
        const { data: closings } = await supabase.from("stock_closings").select("id, system_stock, physical_stock").in("id", closingIds);
        const cm = new Map<string, any>();
        (closings ?? []).forEach((c: any) => cm.set(c.id, c));
        list.forEach((r) => {
          if (r.closing_id && cm.has(r.closing_id)) {
            r.system_stock = Number(cm.get(r.closing_id).system_stock);
            r.physical_stock = Number(cm.get(r.closing_id).physical_stock);
          }
        });
      }

      const userIds = Array.from(new Set(list.map((r) => r.created_by).filter(Boolean))) as string[];
      if (userIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        const map = new Map<string, string>();
        (profs ?? []).forEach((p: any) => map.set(p.id, p.full_name));
        list.forEach((r) => { r.creator_name = r.created_by ? map.get(r.created_by) ?? null : null; });
      }

      const farmIds = Array.from(new Set(list.map((r) => r.farm_id).filter(Boolean))) as string[];
      if (farmIds.length) {
        const { data: fs } = await supabase.from("farms").select("id, name").in("id", farmIds);
        const fm = new Map<string, string>();
        (fs ?? []).forEach((f: any) => fm.set(f.id, f.name));
        list.forEach((r) => { r.farm_name = r.farm_id ? fm.get(r.farm_id) ?? null : null; });
      }
      const shopIds = Array.from(new Set(list.map((r) => r.shop_id).filter(Boolean))) as string[];
      if (shopIds.length) {
        const { data: ss } = await supabase.from("shops").select("id, name").in("id", shopIds);
        const sm = new Map<string, string>();
        (ss ?? []).forEach((s: any) => sm.set(s.id, s.name));
        list.forEach((r) => { r.shop_name = r.shop_id ? sm.get(r.shop_id) ?? null : null; });
      }

      const uniqueTypes = Array.from(new Set(list.map((r) => r.meat_type)));
      if (uniqueTypes.length) {
        const { data: pRates } = await supabase
          .from("purchases")
          .select("meat_type, rate_per_kg, purchase_date")
          .in("meat_type", uniqueTypes)
          .lte("purchase_date", to)
          .is("reversed_at", null)
          .order("purchase_date", { ascending: false });
        const perType = new Map<string, { date: string; rate: number }[]>();
        (pRates ?? []).forEach((p: any) => {
          const arr = perType.get(p.meat_type) ?? [];
          arr.push({ date: p.purchase_date, rate: Number(p.rate_per_kg ?? 0) });
          perType.set(p.meat_type, arr);
        });
        list.forEach((r) => {
          const arr = perType.get(r.meat_type) ?? [];
          const match = arr.find((x) => x.date <= r.adjustment_date);
          const rate = match?.rate ?? 0;
          const dead = Math.abs(Number(r.quantity_kg));
          r.rate = rate;
          r.cost = dead * rate;
        });
      }

      setRows(list);
      setLoading(false);
    })();
  }, [from, to, meatType]);

  useEffect(() => {
    (async () => {
      const start = format(startOfMonth(new Date(analyticsMonth + "-01")), "yyyy-MM-dd");
      const end = format(endOfMonth(new Date(analyticsMonth + "-01")), "yyyy-MM-dd");
      const [{ data: adj }, { data: pAll }, { data: pRates }] = await Promise.all([
        supabase.from("stock_adjustments")
          .select("meat_type, quantity_kg, adjustment_date")
          .eq("reason", "mortality")
          .is("original_adjustment_id", null)
          .is("reversed_at", null)
          .lt("quantity_kg", 0)
          .gte("adjustment_date", start).lte("adjustment_date", end),
        supabase.from("purchases")
          .select("meat_type, weight_kg, purchase_date")
          .gte("purchase_date", start).lte("purchase_date", end)
          .is("reversed_at", null),
        supabase.from("purchases")
          .select("meat_type, rate_per_kg, purchase_date")
          .lte("purchase_date", end)
          .is("reversed_at", null)
          .order("purchase_date", { ascending: false }),
      ]);

      const latestRate = new Map<string, number>();
      (pRates ?? []).forEach((p: any) => {
        if (!latestRate.has(p.meat_type)) latestRate.set(p.meat_type, Number(p.rate_per_kg ?? 0));
      });

      const perType = new Map<string, { deadKg: number; purchasedKg: number }>();
      (adj ?? []).forEach((a: any) => {
        const cur = perType.get(a.meat_type) ?? { deadKg: 0, purchasedKg: 0 };
        cur.deadKg += Math.abs(Number(a.quantity_kg));
        perType.set(a.meat_type, cur);
      });
      (pAll ?? []).forEach((p: any) => {
        const cur = perType.get(p.meat_type) ?? { deadKg: 0, purchasedKg: 0 };
        cur.purchasedKg += Number(p.weight_kg);
        perType.set(p.meat_type, cur);
      });

      const arr: MonthRow[] = Array.from(perType.entries())
        .filter(([, v]) => v.deadKg > 0 || v.purchasedKg > 0)
        .map(([meat_type, v]) => {
          const rate = latestRate.get(meat_type) ?? 0;
          const cost = v.deadKg * rate;
          const pct = v.purchasedKg > 0 ? (v.deadKg / v.purchasedKg) * 100 : 0;
          return { meat_type, deadKg: v.deadKg, cost, purchasedKg: v.purchasedKg, pct };
        })
        .sort((a, b) => b.deadKg - a.deadKg);

      const totalDead = arr.reduce((a, x) => a + x.deadKg, 0);
      const totalCost = arr.reduce((a, x) => a + x.cost, 0);
      const totalPurchased = arr.reduce((a, x) => a + x.purchasedKg, 0);
      const days = Math.max(1, differenceInCalendarDays(new Date(end), new Date(start)) + 1);
      const overallPct = totalPurchased > 0 ? (totalDead / totalPurchased) * 100 : 0;

      setMonthly(arr);
      setMonthlyTotals({ deadKg: totalDead, cost: totalCost, purchasedKg: totalPurchased, avgDaily: totalDead / days, pct: overallPct });
    })();
  }, [analyticsMonth]);

  const totals = useMemo(() => {
    const active = rows.filter((r) => !r.reversed_at);
    return {
      dead: active.reduce((a, r) => a + Math.abs(Number(r.quantity_kg)), 0),
      count: active.length,
      birds: active.reduce((a, r) => a + Number(r.bird_count ?? 0), 0),
      cost: active.reduce((a, r) => a + Number(r.cost ?? 0), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <SeoHead title="Mortality Register — MeatFlow" description="Track dead weight, cost and mortality events per farm/shop from daily closing stock." path="/mortality-register" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Skull className="h-6 w-6 text-destructive" /> Mortality Register
        </h1>
        <p className="text-sm text-muted-foreground">
          Auto-generated from Daily Closing Stock whenever the adjustment reason is Mortality. Reporting only — stock is already adjusted by the closing.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Total Dead Weight</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive"><LoadingValue loading={loading}>{fmtKg(totals.dead)}</LoadingValue></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Mortality Entries</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold"><LoadingValue loading={loading}>{totals.count}</LoadingValue></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Bird Count</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold"><LoadingValue loading={loading}>{totals.birds}</LoadingValue></div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Mortality Cost</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive"><LoadingValue loading={loading}>{fmtMoney(totals.cost)}</LoadingValue></div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="force-ltr w-[160px]" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="force-ltr w-[160px]" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">Meat Type</label>
              <Select value={meatType} onValueChange={setMeatType}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print Report
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Meat Type</TableHead>
                  <TableHead>Farm</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead className="text-end">System</TableHead>
                  <TableHead className="text-end">Physical</TableHead>
                  <TableHead className="text-end">Dead Weight</TableHead>
                  <TableHead className="text-end">Birds</TableHead>
                  <TableHead className="text-end">Rate</TableHead>
                  <TableHead className="text-end">Cost</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={15} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={15} className="text-center py-10 text-muted-foreground">No mortality records in this range.</TableCell></TableRow>
                ) : rows.map((r) => {
                  const dead = Math.abs(Number(r.quantity_kg));
                  return (
                    <TableRow key={r.id} className={r.reversed_at ? "opacity-60" : ""}>
                      <TableCell className="force-ltr">{r.adjustment_date}</TableCell>
                      <TableCell className="font-medium">{r.meat_type}</TableCell>
                      <TableCell>{r.farm_name ?? "—"}</TableCell>
                      <TableCell>{r.shop_name ?? "—"}</TableCell>
                      <TableCell className="text-end">{r.system_stock != null ? fmtKg(r.system_stock) : "—"}</TableCell>
                      <TableCell className="text-end">{r.physical_stock != null ? fmtKg(r.physical_stock) : "—"}</TableCell>
                      <TableCell className="text-end font-semibold text-destructive">{fmtKg(dead)}</TableCell>
                      <TableCell className="text-end">{r.bird_count ?? "—"}</TableCell>
                      <TableCell className="text-end">{r.rate ? fmtMoney(r.rate) : "—"}</TableCell>
                      <TableCell className="text-end font-semibold text-destructive">{r.cost ? fmtMoney(r.cost) : "—"}</TableCell>
                      <TableCell>Mortality</TableCell>
                      <TableCell className="text-sm">{r.notes ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.creator_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell>
                        {r.reversed_at ? (
                          <span className="text-[10px] uppercase tracking-wider text-destructive font-semibold">Reversed</span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider text-success font-semibold">Active</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length > 0 && (
                  <TableRow className="font-semibold bg-muted/50">
                    <TableCell colSpan={6}>Totals (active only)</TableCell>
                    <TableCell className="text-end text-destructive">{fmtKg(totals.dead)}</TableCell>
                    <TableCell className="text-end">{totals.birds}</TableCell>
                    <TableCell />
                    <TableCell className="text-end text-destructive">{fmtMoney(totals.cost)}</TableCell>
                    <TableCell colSpan={5}>{totals.count} entries</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-end justify-between gap-3">
          <div>
            <CardTitle className="text-base">Monthly Mortality Analytics</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Per meat type, based on active (non-reversed) mortality adjustments.</p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">Month</label>
            <Input type="month" value={analyticsMonth} onChange={(e) => setAnalyticsMonth(e.target.value || format(new Date(), "yyyy-MM"))} className="force-ltr w-[160px]" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Dead Weight</div>
              <div className="text-lg font-bold text-destructive"><LoadingValue loading={loading}>{fmtKg(monthlyTotals.deadKg)}</LoadingValue></div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Cost</div>
              <div className="text-lg font-bold text-destructive"><LoadingValue loading={loading}>{fmtMoney(monthlyTotals.cost)}</LoadingValue></div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Daily Mortality</div>
              <div className="text-lg font-bold"><LoadingValue loading={loading}>{fmtKg(monthlyTotals.avgDaily)}</LoadingValue></div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Mortality %</div>
              <div className="text-lg font-bold"><LoadingValue loading={loading}>{monthlyTotals.pct.toFixed(2)}%</LoadingValue></div>
            </div>
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meat Type</TableHead>
                  <TableHead className="text-end">Dead Weight</TableHead>
                  <TableHead className="text-end">Cost</TableHead>
                  <TableHead className="text-end">Purchased Weight</TableHead>
                  <TableHead className="text-end">Mortality %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No mortality or purchases in this month.</TableCell></TableRow>
                ) : monthly.map((m) => (
                  <TableRow key={m.meat_type}>
                    <TableCell className="font-medium">{m.meat_type}</TableCell>
                    <TableCell className="text-end text-destructive">{fmtKg(m.deadKg)}</TableCell>
                    <TableCell className="text-end text-destructive">{fmtMoney(m.cost)}</TableCell>
                    <TableCell className="text-end">{fmtKg(m.purchasedKg)}</TableCell>
                    <TableCell className="text-end font-semibold">{m.pct.toFixed(2)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MortalityRegister;