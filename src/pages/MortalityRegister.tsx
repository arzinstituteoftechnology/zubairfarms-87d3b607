import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEAT_TYPES, fmtKg } from "@/lib/constants";
import { format, subDays } from "date-fns";
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
  system_stock?: number | null;
  physical_stock?: number | null;
  creator_name?: string | null;
};

const MortalityRegister = () => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);
  const [meatType, setMeatType] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Only originating adjustments (exclude reversal entries) with reason=mortality
      // and negative quantity (physical < system → dead weight).
      let q = supabase
        .from("stock_adjustments")
        .select("id, adjustment_date, meat_type, quantity_kg, notes, created_by, created_at, reversed_at, closing_id")
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
        const { data: closings } = await supabase
          .from("stock_closings")
          .select("id, system_stock, physical_stock")
          .in("id", closingIds);
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

      setRows(list);
      setLoading(false);
    })();
  }, [from, to, meatType]);

  const totals = useMemo(() => {
    const active = rows.filter((r) => !r.reversed_at);
    return {
      dead: active.reduce((a, r) => a + Math.abs(Number(r.quantity_kg)), 0),
      count: active.length,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <SeoHead title="Mortality Register — MeatFlow" description="Track dead weight and mortality events recorded from daily closing stock." path="/mortality-register" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Skull className="h-6 w-6 text-destructive" /> Mortality Register
        </h1>
        <p className="text-sm text-muted-foreground">
          Auto-generated from Daily Closing Stock whenever the adjustment reason is Mortality. This register is for reporting only — stock is already adjusted by the closing.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Total Dead Weight</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{fmtKg(totals.dead)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Mortality Entries</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.count}</div></CardContent>
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
                  <TableHead className="text-end">System</TableHead>
                  <TableHead className="text-end">Physical</TableHead>
                  <TableHead className="text-end">Dead Weight</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No mortality records in this range.</TableCell></TableRow>
                ) : rows.map((r) => {
                  const dead = Math.abs(Number(r.quantity_kg));
                  return (
                    <TableRow key={r.id} className={r.reversed_at ? "opacity-60" : ""}>
                      <TableCell className="force-ltr">{r.adjustment_date}</TableCell>
                      <TableCell className="font-medium">{r.meat_type}</TableCell>
                      <TableCell className="text-end">{r.system_stock != null ? fmtKg(r.system_stock) : "—"}</TableCell>
                      <TableCell className="text-end">{r.physical_stock != null ? fmtKg(r.physical_stock) : "—"}</TableCell>
                      <TableCell className="text-end font-semibold text-destructive">{fmtKg(dead)}</TableCell>
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
                    <TableCell colSpan={4}>Totals (active only)</TableCell>
                    <TableCell className="text-end text-destructive">{fmtKg(totals.dead)}</TableCell>
                    <TableCell colSpan={5}>{totals.count} entries</TableCell>
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

export default MortalityRegister;