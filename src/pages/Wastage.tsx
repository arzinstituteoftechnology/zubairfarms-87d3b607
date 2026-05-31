import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { fmtKg, fmtMoney } from "@/lib/constants";
import { AlertTriangle } from "lucide-react";

type DailyRow = { date: string; meat_type: string; purchased: number; supplied: number; wastage: number; wastagePct: number; costLoss: number };
type BatchRow = { id: string; date: string; farm: string; meat_type: string; purchased: number; supplied: number; wastage: number; wastagePct: number; costLoss: number; rate: number };

const Wastage = () => {
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [batch, setBatch] = useState<BatchRow[]>([]);
  const [threshold, setThreshold] = useState(2);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: s }, { data: cfg }] = await Promise.all([
        supabase.from("purchases").select("id, purchase_date, meat_type, weight_kg, rate_per_kg, farms(name)").order("purchase_date", { ascending: false }),
        supabase.from("supplies").select("supply_date, purchase_id, meat_type, weight_kg"),
        supabase.from("settings").select("wastage_threshold_pct").eq("id", 1).maybeSingle(),
      ]);
      const thr = Number(cfg?.wastage_threshold_pct ?? 2);
      setThreshold(thr);

      // Daily aggregate per date+meat_type
      const dmap = new Map<string, DailyRow>();
      (p ?? []).forEach((r: any) => {
        const k = `${r.purchase_date}|${r.meat_type}`;
        const cur = dmap.get(k) ?? { date: r.purchase_date, meat_type: r.meat_type, purchased: 0, supplied: 0, wastage: 0, wastagePct: 0, costLoss: 0 };
        cur.purchased += Number(r.weight_kg);
        // approximate avg rate via cost loss later — store weighted rate sum
        (cur as any)._costSum = ((cur as any)._costSum ?? 0) + Number(r.weight_kg) * Number(r.rate_per_kg);
        dmap.set(k, cur);
      });
      (s ?? []).forEach((r: any) => {
        const k = `${r.supply_date}|${r.meat_type}`;
        const cur = dmap.get(k) ?? { date: r.supply_date, meat_type: r.meat_type, purchased: 0, supplied: 0, wastage: 0, wastagePct: 0, costLoss: 0 };
        cur.supplied += Number(r.weight_kg);
        dmap.set(k, cur);
      });
      const dailyArr = [...dmap.values()].map((r) => {
        const w = r.purchased - r.supplied;
        const avgRate = r.purchased > 0 ? ((r as any)._costSum ?? 0) / r.purchased : 0;
        return { ...r, wastage: w, wastagePct: r.purchased > 0 ? (w / r.purchased) * 100 : 0, costLoss: w * avgRate };
      }).sort((a, b) => b.date.localeCompare(a.date));
      setDaily(dailyArr);

      // Per-batch (per purchase)
      const suppliedByPurchase = new Map<string, number>();
      (s ?? []).forEach((r: any) => {
        if (r.purchase_id) suppliedByPurchase.set(r.purchase_id, (suppliedByPurchase.get(r.purchase_id) ?? 0) + Number(r.weight_kg));
      });
      const batchArr: BatchRow[] = (p ?? []).map((r: any) => {
        const supplied = suppliedByPurchase.get(r.id) ?? 0;
        const purchased = Number(r.weight_kg);
        const w = purchased - supplied;
        return {
          id: r.id, date: r.purchase_date, farm: r.farms?.name ?? "—", meat_type: r.meat_type,
          purchased, supplied, wastage: w,
          wastagePct: purchased > 0 ? (w / purchased) * 100 : 0,
          costLoss: w * Number(r.rate_per_kg), rate: Number(r.rate_per_kg),
        };
      });
      setBatch(batchArr);
      setLoading(false);
    })();
  }, []);

  const renderTable = (rows: (DailyRow | BatchRow)[], type: "daily" | "batch") => (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          {type === "batch" && <TableHead>Farm</TableHead>}
          <TableHead>Date</TableHead>
          <TableHead>Meat</TableHead>
          <TableHead className="text-right">Purchased</TableHead>
          <TableHead className="text-right">Supplied</TableHead>
          <TableHead className="text-right">Wastage</TableHead>
          <TableHead className="text-right">%</TableHead>
          <TableHead className="text-right">Cost loss</TableHead>
          <TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading ? <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            : rows.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No data yet.</TableCell></TableRow>
            : rows.map((r: any) => {
              const excess = r.wastagePct > threshold;
              return (
                <TableRow key={(r.id ?? `${r.date}-${r.meat_type}`)}>
                  {type === "batch" && <TableCell className="font-medium">{r.farm}</TableCell>}
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.meat_type}</TableCell>
                  <TableCell className="text-right">{fmtKg(r.purchased)}</TableCell>
                  <TableCell className="text-right">{fmtKg(r.supplied)}</TableCell>
                  <TableCell className={`text-right font-medium ${r.wastage < 0 ? "text-destructive" : ""}`}>{fmtKg(r.wastage)}</TableCell>
                  <TableCell className="text-right">{r.wastagePct.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.costLoss)}</TableCell>
                  <TableCell>
                    {excess
                      ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Excess</Badge>
                      : <Badge variant="secondary">OK</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wastage</h1>
          <p className="text-sm text-muted-foreground">Weight difference between purchases and supplies. Excess threshold: <span className="font-semibold text-foreground">{threshold}%</span></p>
        </div>
      </div>
      <Card className="p-4">
        <Tabs defaultValue="daily">
          <TabsList>
            <TabsTrigger value="daily">Daily aggregate</TabsTrigger>
            <TabsTrigger value="batch">Per-batch</TabsTrigger>
          </TabsList>
          <TabsContent value="daily" className="mt-4">{renderTable(daily, "daily")}</TabsContent>
          <TabsContent value="batch" className="mt-4">{renderTable(batch, "batch")}</TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};
export default Wastage;