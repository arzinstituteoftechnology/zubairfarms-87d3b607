import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtKg, fmtMoney } from "@/lib/constants";
import { ShoppingCart, Truck, Boxes, TrendingUp, Beef, Wallet, Users } from "lucide-react";
import { format, subDays } from "date-fns";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";

interface KPI {
  purchaseKg: number; purchaseAmt: number;
  supplyKg: number; supplyAmt: number;
  stockKg: number;
  profit: number;
  payableToFarms: number; receivableFromCustomers: number;
}

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
  const [kpi, setKpi] = useState<KPI>({ purchaseKg: 0, purchaseAmt: 0, supplyKg: 0, supplyAmt: 0, stockKg: 0, profit: 0, payableToFarms: 0, receivableFromCustomers: 0 });
  const [chart, setChart] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const last7 = format(subDays(new Date(), 6), "yyyy-MM-dd");

      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("purchases").select("purchase_date, meat_type, weight_kg, rate_per_kg, total_amount").gte("purchase_date", last7),
        supabase.from("supplies").select("supply_date, meat_type, weight_kg, rate_per_kg, cost_per_kg, total_amount").gte("supply_date", last7),
      ]);
      // Also pull all-time for stock
      const [{ data: pAll }, { data: sAll }] = await Promise.all([
        supabase.from("purchases").select("weight_kg, total_amount, meat_type, rate_per_kg, purchase_date").eq("purchase_date", today),
        supabase.from("supplies").select("weight_kg, total_amount, cost_per_kg, supply_date").eq("supply_date", today),
      ]);
      const [{ data: pSum }, { data: sSum }] = await Promise.all([
        supabase.from("purchases").select("weight_kg, rate_per_kg, meat_type, total_amount, paid_amount"),
        supabase.from("supplies").select("weight_kg, cost_per_kg, total_amount, meat_type"),
      ]);
      const [{ data: fpAll }, { data: posAll }] = await Promise.all([
        supabase.from("farm_payments").select("amount"),
        supabase.from("pos_sales").select("due"),
      ]);

      const sum = (arr: any[] | null, k: string) => (arr ?? []).reduce((a, x) => a + Number(x[k] ?? 0), 0);
      const purchaseKg = sum(pAll, "weight_kg");
      const purchaseAmt = sum(pAll, "total_amount");
      const supplyKg = sum(sAll, "weight_kg");
      const supplyAmt = sum(sAll, "total_amount");
      const stockKg = sum(pSum, "weight_kg") - sum(sSum, "weight_kg");
      const totalPurchasedAll = sum(pSum, "weight_kg");
      // avg cost per kg from all purchases
      const purchaseValue = (pSum ?? []).reduce((a, x: any) => a + Number(x.weight_kg) * Number(x.rate_per_kg), 0);
      // profit = supplies revenue - cost of supplied
      const supplyRevenue = (sSum ?? []).reduce((a, x: any) => a + Number(x.total_amount ?? 0), 0);
      const supplyCost = (sSum ?? []).reduce((a, x: any) => a + Number(x.weight_kg) * Number(x.cost_per_kg ?? 0), 0);
      const profit = supplyRevenue - supplyCost;

      // Payable to farms = total purchases - (paid_amount on purchases + farm_payments)
      const totalPurchaseAmt = (pSum ?? []).reduce((a, x: any) => a + Number(x.total_amount ?? 0), 0);
      const paidOnPurchases = (pSum ?? []).reduce((a, x: any) => a + Number(x.paid_amount ?? 0), 0);
      const extraFarmPaid = (fpAll ?? []).reduce((a, x: any) => a + Number(x.amount ?? 0), 0);
      const payableToFarms = Math.max(0, totalPurchaseAmt - paidOnPurchases - extraFarmPaid);
      const receivableFromCustomers = (posAll ?? []).reduce((a, x: any) => a + Number(x.due ?? 0), 0);

      setKpi({ purchaseKg, purchaseAmt, supplyKg, supplyAmt, stockKg, profit, payableToFarms, receivableFromCustomers });

      // 7-day chart
      const days: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        const purchased = (p ?? []).filter((x: any) => x.purchase_date === d).reduce((a, x: any) => a + Number(x.weight_kg), 0);
        const supplied = (s ?? []).filter((x: any) => x.supply_date === d).reduce((a, x: any) => a + Number(x.weight_kg), 0);
        days.push({ day: format(subDays(new Date(), i), "EEE"), purchased, supplied });
      }
      setChart(days);

      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">{loading ? t("common.loading") : t("dashboard.subtitle")}</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ShoppingCart} label={t("dashboard.todays_purchase")} value={fmtKg(kpi.purchaseKg)} sub={t("dashboard.amt", { value: fmtMoney(kpi.purchaseAmt) })} />
        <KpiCard icon={Truck} label={t("dashboard.todays_supply")} value={fmtKg(kpi.supplyKg)} sub={t("dashboard.amt", { value: fmtMoney(kpi.supplyAmt) })} />
        <KpiCard icon={Boxes} label={t("dashboard.current_stock")} value={fmtKg(kpi.stockKg)} tone={kpi.stockKg < 0 ? "danger" : "default"} />
        <KpiCard icon={TrendingUp} label={t("dashboard.todays_profit")} value={fmtMoney(kpi.profit)} tone={kpi.profit >= 0 ? "success" : "danger"} sub={t("dashboard.revenue_minus_cost")} />
        <KpiCard icon={Wallet} label={t("dashboard.payable_to_farms")} value={fmtMoney(kpi.payableToFarms)} sub={t("dashboard.total_udhaar")} tone="danger" />
        <KpiCard icon={Users} label={t("dashboard.receivable")} value={fmtMoney(kpi.receivableFromCustomers)} sub={t("dashboard.customer_dues")} tone="danger" />
        <KpiCard icon={Beef} label={t("dashboard.total_purchase_value")} value={fmtMoney(kpi.purchaseAmt)} sub={t("dashboard.today")} />
        <KpiCard icon={Truck} label={t("dashboard.total_supply_value")} value={fmtMoney(kpi.supplyAmt)} sub={t("dashboard.today")} />
      </div>

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