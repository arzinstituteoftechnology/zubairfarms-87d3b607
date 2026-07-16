import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEAT_TYPES, fmtKg, fmtMoney } from "@/lib/constants";
import { format, subDays } from "date-fns";
import { Printer } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";

const REASON_LABELS: Record<string, string> = {
  weight_loss: "Weight Loss", mortality: "Mortality", wastage: "Wastage",
  damage: "Damage", theft: "Theft", other: "Other", leakage: "Leakage",
  scale_difference: "Scale Difference", counting_difference: "Counting Difference",
  purchase_entry_error: "Purchase Entry Error", supply_entry_error: "Supply Entry Error",
  opening_stock_correction: "Opening Stock Correction",
  weight_gain: "Weight Gain", moisture_gain: "Moisture Gain",
  purchase_under_recorded: "Purchase Under-recorded",
  supply_over_recorded: "Supply Over-recorded",
  measurement_correction: "Measurement Correction",
  previous_closing_correction: "Previous Closing Correction",
};

type Row = {
  id: string;
  closing_date: string;
  meat_type: string;
  opening_stock: number;
  system_stock: number;
  physical_stock: number;
  difference: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  creator_name?: string | null;
  variance_type?: "balanced" | "shortage" | "surplus" | null;
  status?: "draft" | "finalized" | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  mortality_weight?: number | null;
  positive_adjustments_kg?: number | null;
  negative_adjustments_kg?: number | null;
  expected_closing_stock?: number | null;
  variance_weight?: number | null;
  shortage_cost?: number | null;
  finalized_at?: string | null;
  finalized_by?: string | null;
  finalizer_name?: string | null;
  reversed_by?: string | null;
  reverser_name?: string | null;
  surplus_value?: number | null;
};

const ClosingHistory = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);
  const [meatType, setMeatType] = useState<string>("all");
  const [varianceFilter, setVarianceFilter] = useState<string>("all"); // all|balanced|shortage|surplus|reversed
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase
        .from("stock_closings")
        .select("id, closing_date, meat_type, opening_stock, system_stock, physical_stock, difference, reason, created_by, created_at, variance_type, status, reversed_at, reversed_by, reversal_reason, mortality_weight, positive_adjustments_kg, negative_adjustments_kg, expected_closing_stock, variance_weight, shortage_cost, finalized_at, finalized_by, tenant_id")
        .gte("closing_date", from).lte("closing_date", to)
        .order("closing_date", { ascending: false }).order("meat_type");
      if (meatType !== "all") q = q.eq("meat_type", meatType);
      if (varianceFilter === "reversed") q = q.not("reversed_at", "is", null);
      else if (varianceFilter === "draft") q = q.eq("status", "draft").is("reversed_at", null);
      else if (varianceFilter === "finalized") q = q.eq("status", "finalized").is("reversed_at", null);
      else if (varianceFilter !== "all") q = q.eq("variance_type", varianceFilter as any);
      const { data } = await q;
      const list = (data ?? []) as Row[];

      const ids = Array.from(new Set([
        ...list.map((r) => r.created_by).filter(Boolean) as string[],
        ...list.map((r) => r.finalized_by).filter(Boolean) as string[],
        ...list.map((r) => r.reversed_by).filter(Boolean) as string[],
      ]));
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        const map = new Map<string, string>();
        (profs ?? []).forEach((p: any) => map.set(p.id, p.full_name));
        list.forEach((r) => {
          r.creator_name = r.created_by ? map.get(r.created_by) ?? null : null;
          r.finalizer_name = r.finalized_by ? map.get(r.finalized_by) ?? null : null;
          r.reverser_name = r.reversed_by ? map.get(r.reversed_by) ?? null : null;
        });
      }
      // Surplus value valuation using rolling 30-day weighted-average purchase rate
      const surplusRows = list.filter((r) => Number(r.variance_weight ?? r.difference ?? 0) > 0 && !r.reversed_at);
      await Promise.all(surplusRows.map(async (r: any) => {
        const { data } = await supabase.rpc("compute_closing_war", {
          p_tenant: r.tenant_id, p_meat: r.meat_type, p_date: r.closing_date,
        });
        const war = Number(data ?? 0);
        const varKg = Number(r.variance_weight ?? r.difference ?? 0);
        r.surplus_value = Math.round(Math.max(0, varKg) * war * 100) / 100;
      }));
      setRows(list); setLoading(false);
    })();
  }, [from, to, meatType, varianceFilter]);

  const totals = useMemo(() => {
    return rows.reduce((a, r) => ({
      opening: a.opening + Number(r.opening_stock),
      system: a.system + Number(r.system_stock),
      physical: a.physical + Number(r.physical_stock),
      diff: a.diff + Number(r.difference),
      shortageCost: a.shortageCost + Number(r.shortage_cost ?? 0),
      surplusValue: a.surplusValue + Number(r.surplus_value ?? 0),
    }), { opening: 0, system: 0, physical: 0, diff: 0, shortageCost: 0, surplusValue: 0 });
  }, [rows]);

  return (
    <div className="space-y-6">
      <SeoHead title="Closing History — MeatFlow" description="Historical daily closing stock and adjustment reasons." path="/closing-history" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Closing History</h1>
        <p className="text-sm text-muted-foreground">Review daily physical closing stock, differences and adjustment reasons.</p>
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
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">Variance</label>
              <Select value={varianceFilter} onValueChange={setVarianceFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="shortage">Shortage</SelectItem>
                  <SelectItem value="surplus">Surplus</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="finalized">Finalized</SelectItem>
                  <SelectItem value="reversed">Reversed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Meat Type</TableHead>
                  <TableHead className="text-end">Opening</TableHead>
                  <TableHead className="text-end">Expected</TableHead>
                  <TableHead className="text-end">Physical</TableHead>
                  <TableHead className="text-end">Variance</TableHead>
                  <TableHead className="text-end">Shortage Cost</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Finalized By</TableHead>
                  <TableHead>Finalized At</TableHead>
                  <TableHead>Created At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">No closing records in this range.</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id} className={r.reversed_at ? "opacity-60" : ""}>
                    <TableCell className="force-ltr">{r.closing_date}</TableCell>
                    <TableCell className="font-medium">{r.meat_type}</TableCell>
                    <TableCell className="text-end">{fmtKg(r.opening_stock)}</TableCell>
                    <TableCell className="text-end">{fmtKg(r.expected_closing_stock ?? r.system_stock)}</TableCell>
                    <TableCell className="text-end">{fmtKg(r.physical_stock)}</TableCell>
                    <TableCell className={`text-end font-semibold ${Number(r.variance_weight ?? r.difference) < 0 ? "text-destructive" : Number(r.variance_weight ?? r.difference) > 0 ? "text-success" : ""}`}>
                      {Number(r.variance_weight ?? r.difference) > 0 ? "+" : ""}{fmtKg(r.variance_weight ?? r.difference)}
                    </TableCell>
                    <TableCell className={`text-end ${Number(r.shortage_cost ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{fmtMoney(r.shortage_cost ?? 0)}</TableCell>
                    <TableCell>
                      {r.reversed_at ? (
                        <span className="text-xs uppercase tracking-wider text-destructive">Reversed</span>
                      ) : r.variance_type === "shortage" ? (
                        <span className="text-xs uppercase tracking-wider text-destructive">Shortage</span>
                      ) : r.variance_type === "surplus" ? (
                        <span className="text-xs uppercase tracking-wider text-warning">Surplus</span>
                      ) : r.variance_type === "balanced" ? (
                        <span className="text-xs uppercase tracking-wider text-success">Balanced</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {r.status === "draft" && !r.reversed_at && (
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">draft</div>
                      )}
                      {r.status === "finalized" && !r.reversed_at && (
                        <div className="text-[10px] uppercase tracking-wider text-success">finalized</div>
                      )}
                    </TableCell>
                    <TableCell>{r.reason ? REASON_LABELS[r.reason] ?? r.reason : "—"}</TableCell>
                    <TableCell className="text-sm">{r.finalizer_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.finalized_at ? new Date(r.finalized_at).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {rows.length > 0 && (
                  <TableRow className="font-semibold bg-muted/50">
                    <TableCell colSpan={2}>Totals</TableCell>
                    <TableCell className="text-end">{fmtKg(totals.opening)}</TableCell>
                    <TableCell className="text-end">{fmtKg(totals.system)}</TableCell>
                    <TableCell className="text-end">{fmtKg(totals.physical)}</TableCell>
                    <TableCell className={`text-end ${totals.diff < 0 ? "text-destructive" : totals.diff > 0 ? "text-success" : ""}`}>
                      {totals.diff > 0 ? "+" : ""}{fmtKg(totals.diff)}
                    </TableCell>
                    <TableCell className="text-end text-destructive">{fmtMoney(totals.shortageCost)}</TableCell>
                    <TableCell colSpan={5} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClosingHistory;