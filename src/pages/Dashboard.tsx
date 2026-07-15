import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtKg, fmtMoney } from "@/lib/constants";
import { ShoppingCart, Truck, Boxes, TrendingUp, Beef, Wallet, Users, HandCoins, Skull, PackageMinus } from "lucide-react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { useModuleFlags } from "@/hooks/useModuleFlags";
import { SeoHead } from "@/components/SeoHead";
import { useSettingsLists, activeOnly } from "@/hooks/useSettingsLists";
import { calcRealizedProfit } from "@/lib/profit";

interface KPI {
  purchaseKg: number; purchaseAmt: number;
  supplyKg: number; supplyAmt: number;
  stockKg: number;
  profit: number;
  payableToFarms: number; receivableFromCustomers: number;
  recoveryToday: number; recoveryWeek: number; recoveryMonth: number;
  mortalityToday: number; mortalityWeek: number; mortalityMonth: number; mortalityCost: number;
  inventoryLossToday: number;
  breakdownToday: Record<string, number>;
  breakdownWeek: Record<string, number>;
  breakdownMonth: Record<string, number>;
}

const DEFAULT_REASONS: { value: string; label: string }[] = [
  { value: "mortality", label: "Mortality" },
  { value: "weight_loss", label: "Weight Loss" },
  { value: "wastage", label: "Wastage" },
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft" },
  { value: "other", label: "Other" },
];
const emptyBreakdown = (): Record<string, number> => Object.fromEntries(DEFAULT_REASONS.map(r => [r.value, 0]));
const emptyKpi: KPI = { purchaseKg: 0, purchaseAmt: 0, supplyKg: 0, supplyAmt: 0, stockKg: 0, profit: 0, payableToFarms: 0, receivableFromCustomers: 0, recoveryToday: 0, recoveryWeek: 0, recoveryMonth: 0, mortalityToday: 0, mortalityWeek: 0, mortalityMonth: 0, mortalityCost: 0, inventoryLossToday: 0, breakdownToday: emptyBreakdown(), breakdownWeek: emptyBreakdown(), breakdownMonth: emptyBreakdown() };

const KpiCard = ({ icon: Icon, label, value, sub, tone = "default" }: any) => (
  <Card>
    <CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-bold ${tone === "danger" ? "text-destructive" : tone === "success" ? "text-success" : ""}`}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const { t } = useTranslation();
  const [kpi, setKpi] = useState<KPI>(emptyKpi);
  const [chart, setChart] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedDate, setSelectedDate, today: currentDate, isToday } = useLedgerDate();
  const { customers_module_enabled: customersEnabled } = useModuleFlags();
  const { adjustmentReasons } = useSettingsLists();
  const REASONS = (adjustmentReasons.length
    ? activeOnly(adjustmentReasons).map(r => ({ value: r.code, label: r.name }))
    : DEFAULT_REASONS);

  const load = useCallback(async () => {
    setLoading(true);
      const today = selectedDate;
      const last7 = format(subDays(new Date(selectedDate), 6), "yyyy-MM-dd");

      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("purchases").select("purchase_date, meat_type, weight_kg, rate_per_kg, total_amount").gte("purchase_date", last7).lte("purchase_date", today).is("reversed_at", null),
        supabase.from("supplies").select("supply_date, meat_type, weight_kg, rate_per_kg, cost_per_kg, total_amount").gte("supply_date", last7).lte("supply_date", today).is("reversed_at", null),
      ]);
      // Pull the selected-date slice (reversed rows must NOT count anywhere)
      const [{ data: pAll }, { data: sAll }] = await Promise.all([
        supabase.from("purchases").select("weight_kg, total_amount, meat_type, rate_per_kg, purchase_date").eq("purchase_date", today).is("reversed_at", null),
        supabase.from("supplies").select("weight_kg, total_amount, cost_per_kg, rate_per_kg, supply_date").eq("supply_date", today).is("reversed_at", null),
      ]);
      // Stock balance: use latest physical closing (per meat_type) on/before selectedDate,
      // then add purchases and subtract supplies AFTER that closing up to selectedDate.
      // If no closing has ever been recorded, fall back to cumulative purchases − supplies.
      const [{ data: closings }, { data: pCumAll }, { data: sCumAll }, { data: adjCum }] = await Promise.all([
        supabase.from("stock_closings").select("meat_type, physical_stock, closing_date").lte("closing_date", today).order("closing_date", { ascending: false }),
        supabase.from("purchases").select("meat_type, weight_kg, purchase_date").lte("purchase_date", today).is("reversed_at", null),
        supabase.from("supplies").select("meat_type, weight_kg, supply_date").lte("supply_date", today).is("reversed_at", null),
        supabase.from("stock_adjustments").select("meat_type, quantity_kg, adjustment_date").lte("adjustment_date", today).is("reversed_at", null).is("original_adjustment_id", null),
      ]);
      const latestClosing = new Map<string, { physical: number; date: string }>();
      (closings ?? []).forEach((c: any) => {
        if (!latestClosing.has(c.meat_type)) latestClosing.set(c.meat_type, { physical: Number(c.physical_stock ?? 0), date: c.closing_date });
      });
      const meatKeys = new Set<string>([
        ...(pCumAll ?? []).map((r: any) => r.meat_type),
        ...(sCumAll ?? []).map((r: any) => r.meat_type),
        ...latestClosing.keys(),
      ]);
      let stockKg = 0;
      meatKeys.forEach((mt) => {
        const c = latestClosing.get(mt);
        if (c) {
          const pAfter = (pCumAll ?? []).filter((r: any) => r.meat_type === mt && r.purchase_date > c.date).reduce((a, r: any) => a + Number(r.weight_kg), 0);
          const sAfter = (sCumAll ?? []).filter((r: any) => r.meat_type === mt && r.supply_date > c.date).reduce((a, r: any) => a + Number(r.weight_kg), 0);
          const aAfter = (adjCum ?? []).filter((r: any) => r.meat_type === mt && r.adjustment_date > c.date).reduce((a, r: any) => a + Number(r.quantity_kg), 0);
          stockKg += c.physical + pAfter - sAfter + aAfter;
        } else {
          const pAll2 = (pCumAll ?? []).filter((r: any) => r.meat_type === mt).reduce((a, r: any) => a + Number(r.weight_kg), 0);
          const sAll2 = (sCumAll ?? []).filter((r: any) => r.meat_type === mt).reduce((a, r: any) => a + Number(r.weight_kg), 0);
          const aAll2 = (adjCum ?? []).filter((r: any) => r.meat_type === mt).reduce((a, r: any) => a + Number(r.quantity_kg), 0);
          stockKg += pAll2 - sAll2 + aAll2;
        }
      });
      // Cumulative outstanding as-of selected date (Total Udhaar / Receivable).
      // Reversed rows are excluded so a reversal instantly clears the balance.
      const [
        { data: farmsRows }, { data: puCum }, { data: fpCum }, { data: leCum },
        { data: posCum }, { data: cpCum },
      ] = await Promise.all([
        supabase.from("farms").select("id, opening_balance").is("deleted_at", null),
        supabase.from("purchases").select("total_amount, paid_amount, purchase_date").lte("purchase_date", today).is("reversed_at", null),
        supabase.from("farm_payments").select("amount, payment_date").lte("payment_date", today).is("reversed_at", null),
        supabase.from("supplier_ledger_entries").select("entry_type, amount, entry_date, reversed_at, original_entry_id").lte("entry_date", today),
        supabase.from("pos_sales").select("due, sale_date").lte("sale_date", today),
        supabase.from("customer_payments").select("amount, payment_date").lte("payment_date", today),
      ]);
      const weekStart = format(startOfWeek(new Date(selectedDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const monthStart = format(startOfMonth(new Date(selectedDate)), "yyyy-MM-dd");
      const { data: recAll } = await supabase
        .from("shop_recoveries")
        .select("amount, recovery_date")
        .gte("recovery_date", monthStart)
        .lte("recovery_date", today)
        .is("reversed_at", null);

      const sum = (arr: any[] | null, k: string) => (arr ?? []).reduce((a, x) => a + Number(x[k] ?? 0), 0);
      const purchaseKg = sum(pAll, "weight_kg");
      const purchaseAmt = sum(pAll, "total_amount");
      const supplyKg = sum(sAll, "weight_kg");
      const supplyAmt = sum(sAll, "total_amount");
      // Realized Profit on the selected date is calculated PER SUPPLY LINE:
      //   Σ supplied_weight × (sale_rate_per_kg − cost_per_kg)
      // We do NOT subtract full purchase value from supply revenue — remaining
      // stock is inventory, not loss. This matches the profit shown in each
      // supply row/edit modal.
      const profit = calcRealizedProfit(sAll ?? []);

      // Payable to farms (Total Udhaar) — cumulative as-of selected date.
      // Mirrors the Suppliers ledger balance math so Dashboard matches Suppliers.
      const openingFarms = (farmsRows ?? []).reduce((a, f: any) => a + Number(f.opening_balance ?? 0), 0);
      const totalPurchaseAmt = (puCum ?? []).reduce((a, x: any) => a + Number(x.total_amount ?? 0), 0);
      const paidOnPurchases = (puCum ?? []).reduce((a, x: any) => a + Number(x.paid_amount ?? 0), 0);
      const extraFarmPaid = (fpCum ?? []).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
      let ledgerAdj = 0;
      (leCum ?? []).forEach((x: any) => {
        if (x.reversed_at || x.original_entry_id) return; // skip originals-of-reversals and reversal entries
        const amt = Number(x.amount ?? 0);
        switch (x.entry_type) {
          case "manual_purchase":
          case "adjustment_increase":
            ledgerAdj += amt; break;
          case "manual_payment":
          case "adjustment_decrease":
            ledgerAdj -= amt; break;
          // opening_balance is already on farms.opening_balance; reversed_* are skipped above.
        }
      });
      const payableToFarms = Math.max(0, openingFarms + totalPurchaseAmt - paidOnPurchases - extraFarmPaid + ledgerAdj);
      // Receivables = cumulative POS "due" MINUS cumulative customer payments
      // (customer_payments do NOT write back to pos_sales.due).
      const dueFromSales = (posCum ?? []).reduce((a, x: any) => a + Number(x.due ?? 0), 0);
      const paidByCustomers = (cpCum ?? []).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
      const receivableFromCustomers = Math.max(0, dueFromSales - paidByCustomers);

      const recoveryToday = (recAll ?? []).filter((x: any) => x.recovery_date === today).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
      const recoveryWeek = (recAll ?? []).filter((x: any) => x.recovery_date >= weekStart).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
      const recoveryMonth = (recAll ?? []).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);

      // Mortality: active adjustments with reason=mortality, sum of |quantity| in kg for today/week/month
      const { data: mortAll } = await supabase
        .from("stock_adjustments")
        .select("meat_type, quantity_kg, adjustment_date")
        .eq("reason", "mortality")
        .is("original_adjustment_id", null)
        .is("reversed_at", null)
        .lt("quantity_kg", 0)
        .gte("adjustment_date", monthStart)
        .lte("adjustment_date", today);
      const absKg = (r: any) => Math.abs(Number(r.quantity_kg ?? 0));
      const mortalityToday = (mortAll ?? []).filter((x: any) => x.adjustment_date === today).reduce((a, x: any) => a + absKg(x), 0);
      const mortalityWeek = (mortAll ?? []).filter((x: any) => x.adjustment_date >= weekStart).reduce((a, x: any) => a + absKg(x), 0);
      const mortalityMonth = (mortAll ?? []).reduce((a, x: any) => a + absKg(x), 0);
      // Mortality cost: use latest purchase rate per meat_type on or before today
      const mortTypes = Array.from(new Set((mortAll ?? []).map((r: any) => r.meat_type)));
      let mortalityCost = 0;
      if (mortTypes.length) {
        const { data: rateRows } = await supabase
          .from("purchases")
          .select("meat_type, rate_per_kg, purchase_date")
          .in("meat_type", mortTypes)
          .lte("purchase_date", today)
          .is("reversed_at", null)
          .order("purchase_date", { ascending: false });
        const latestRate = new Map<string, number>();
        (rateRows ?? []).forEach((p: any) => {
          if (!latestRate.has(p.meat_type)) latestRate.set(p.meat_type, Number(p.rate_per_kg ?? 0));
        });
        mortalityCost = (mortAll ?? []).reduce((a, x: any) => a + absKg(x) * (latestRate.get(x.meat_type) ?? 0), 0);
      }

      // All negative adjustments (any reason) — active, non-reversal — for month → today
      const { data: adjAll } = await supabase
        .from("stock_adjustments")
        .select("reason, quantity_kg, adjustment_date")
        .is("original_adjustment_id", null)
        .is("reversed_at", null)
        .lt("quantity_kg", 0)
        .gte("adjustment_date", monthStart)
        .lte("adjustment_date", today);
      const breakdownToday = emptyBreakdown();
      const breakdownWeek = emptyBreakdown();
      const breakdownMonth = emptyBreakdown();
      (adjAll ?? []).forEach((x: any) => {
        const key = (x.reason ?? "other") as string;
        const bkey = key in breakdownMonth ? key : "other";
        const kg = absKg(x);
        breakdownMonth[bkey] += kg;
        if (x.adjustment_date >= weekStart) breakdownWeek[bkey] += kg;
        if (x.adjustment_date === today) breakdownToday[bkey] += kg;
      });
      const inventoryLossToday = Object.values(breakdownToday).reduce((a, v) => a + v, 0);

      setKpi({ purchaseKg, purchaseAmt, supplyKg, supplyAmt, stockKg, profit, payableToFarms, receivableFromCustomers, recoveryToday, recoveryWeek, recoveryMonth, mortalityToday, mortalityWeek, mortalityMonth, mortalityCost, inventoryLossToday, breakdownToday, breakdownWeek, breakdownMonth });

      // 7-day chart ending at selected date
      const days: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const dayDate = subDays(new Date(selectedDate), i);
        const d = format(dayDate, "yyyy-MM-dd");
        const purchased = (p ?? []).filter((x: any) => x.purchase_date === d).reduce((a, x: any) => a + Number(x.weight_kg), 0);
        const supplied = (s ?? []).filter((x: any) => x.supply_date === d).reduce((a, x: any) => a + Number(x.weight_kg), 0);
        days.push({ day: format(dayDate, "EEE"), purchased, supplied });
      }
      setChart(days);

      setLoading(false);
  }, [selectedDate]);

  useEffect(() => { setKpi(emptyKpi); setChart([]); load(); }, [load]);

  // Realtime — recompute whenever anything that feeds the dashboard changes
  // (purchases, supplies, adjustments, closings, recoveries). This ensures
  // reversing a Daily Closing adjustment immediately updates stock & loss KPIs.
  useEffect(() => {
    const ch = supabase.channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_adjustments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_closings" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "supplies" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_recoveries" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "farm_payments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_sales" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return (
    <div className="space-y-6">
      <SeoHead
        title="Dashboard — Zubair MeatFlow"
        description="Overview of purchases, supplies, stock, recovery and profit across your MeatFlow operation."
        path="/"
      />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{loading ? t("common.loading") : t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{t("dashboard.select_date")}</label>
            <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value || currentDate)} className="force-ltr w-[180px]" />
          </div>
          <Button variant="outline" disabled={isToday} onClick={() => setSelectedDate(currentDate)}>{t("dashboard.today_btn")}</Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ShoppingCart} label={isToday ? t("dashboard.todays_purchase") : t("dashboard.purchase_on")} value={fmtKg(kpi.purchaseKg)} sub={t("dashboard.amt", { value: fmtMoney(kpi.purchaseAmt) })} />
        <KpiCard icon={Truck} label={isToday ? t("dashboard.todays_supply") : t("dashboard.supply_on")} value={fmtKg(kpi.supplyKg)} sub={t("dashboard.amt", { value: fmtMoney(kpi.supplyAmt) })} />
        <KpiCard icon={Boxes} label={isToday ? t("dashboard.current_stock") : t("dashboard.stock_on")} value={fmtKg(kpi.stockKg)} tone={kpi.stockKg < 0 ? "danger" : "default"} sub={selectedDate} />
        <KpiCard icon={TrendingUp} label={isToday ? t("dashboard.todays_profit") : t("dashboard.profit_on")} value={fmtMoney(kpi.profit)} tone={kpi.profit >= 0 ? "success" : "danger"} sub={t("dashboard.revenue_minus_cost")} />
        <KpiCard icon={Wallet} label={t("dashboard.payable_to_farms")} value={fmtMoney(kpi.payableToFarms)} sub={t("dashboard.total_udhaar")} tone="danger" />
        {customersEnabled && (
          <KpiCard icon={Users} label={t("dashboard.receivable")} value={fmtMoney(kpi.receivableFromCustomers)} sub={t("dashboard.customer_dues")} tone="danger" />
        )}
        <KpiCard icon={Beef} label={t("dashboard.total_purchase_value")} value={fmtMoney(kpi.purchaseAmt)} sub={selectedDate} />
        <KpiCard icon={Truck} label={t("dashboard.total_supply_value")} value={fmtMoney(kpi.supplyAmt)} sub={selectedDate} />
        <KpiCard icon={HandCoins} label="Today's Recovery" value={fmtMoney(kpi.recoveryToday)} sub={selectedDate} tone="success" />
        <KpiCard icon={HandCoins} label="This Week Recovery" value={fmtMoney(kpi.recoveryWeek)} sub="Mon → selected" tone="success" />
        <KpiCard icon={HandCoins} label="This Month Recovery" value={fmtMoney(kpi.recoveryMonth)} sub="Month to date" tone="success" />
        <KpiCard icon={Skull} label="Today's Mortality" value={fmtKg(kpi.mortalityToday)} sub={selectedDate} tone={kpi.mortalityToday > 0 ? "danger" : "default"} />
        <KpiCard icon={Skull} label="This Week Mortality" value={fmtKg(kpi.mortalityWeek)} sub="Mon → selected" tone={kpi.mortalityWeek > 0 ? "danger" : "default"} />
        <KpiCard icon={Skull} label="This Month Mortality" value={fmtKg(kpi.mortalityMonth)} sub="Month to date" tone={kpi.mortalityMonth > 0 ? "danger" : "default"} />
        <KpiCard icon={Wallet} label="Mortality Cost (Month)" value={fmtMoney(kpi.mortalityCost)} sub="Dead weight × latest rate" tone={kpi.mortalityCost > 0 ? "danger" : "default"} />
        <KpiCard icon={PackageMinus} label="Today's Inventory Loss" value={fmtKg(kpi.inventoryLossToday)} sub="All negative adjustments" tone={kpi.inventoryLossToday > 0 ? "danger" : "default"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Inventory Loss Breakdown by Reason</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 px-4 font-medium text-right">Today</th>
                  <th className="py-2 px-4 font-medium text-right">This Week</th>
                  <th className="py-2 pl-4 font-medium text-right">This Month</th>
                </tr>
              </thead>
              <tbody>
                {REASONS.map((r) => (
                  <tr key={r.value} className="border-b last:border-b-0">
                    <td className="py-2 pr-4">{r.label}</td>
                    <td className="py-2 px-4 text-right">{fmtKg(kpi.breakdownToday[r.value] ?? 0)}</td>
                    <td className="py-2 px-4 text-right">{fmtKg(kpi.breakdownWeek[r.value] ?? 0)}</td>
                    <td className="py-2 pl-4 text-right">{fmtKg(kpi.breakdownMonth[r.value] ?? 0)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 px-4 text-right">{fmtKg(Object.values(kpi.breakdownToday).reduce((a, v) => a + v, 0))}</td>
                  <td className="py-2 px-4 text-right">{fmtKg(Object.values(kpi.breakdownWeek).reduce((a, v) => a + v, 0))}</td>
                  <td className="py-2 pl-4 text-right">{fmtKg(Object.values(kpi.breakdownMonth).reduce((a, v) => a + v, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">{t("dashboard.chart_title")}</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={{ purchased: { label: t("dashboard.purchased"), color: "hsl(var(--primary))" }, supplied: { label: t("dashboard.supplied"), color: "hsl(var(--accent))" } }} className="h-[260px] w-full force-ltr">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="purchased" fill="var(--color-purchased)" name={t("dashboard.purchased")} radius={[4, 4, 0, 0]} />
                <Bar dataKey="supplied" fill="var(--color-supplied)" name={t("dashboard.supplied")} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
export default Dashboard;