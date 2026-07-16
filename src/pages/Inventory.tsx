import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEAT_TYPES, fmtKg } from "@/lib/constants";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { Boxes, ChevronDown, ChevronRight, Printer, FileSpreadsheet, FileText, PackageMinus, TrendingDown, CalendarDays, CalendarRange } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";
import { printReport } from "@/lib/printReport";
import { format, startOfWeek, startOfMonth } from "date-fns";
import { useSettingsLists } from "@/hooks/useSettingsLists";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ReasonKey = string; // reason_id (uuid) OR legacy code fallback
type ReasonMeta = { key: string; label: string };

type Row = {
  meat_type: string;
  opening: number;
  purchased: number;
  supplied: number;
  loss: number; // positive number = total loss
  current: number;
  breakdown: Record<ReasonKey, number>;
  posAdj: number;      // sum of quantity_kg > 0 (excluding mortality)
  negAdj: number;      // absolute sum of quantity_kg < 0 (excluding mortality)
  mortality: number;   // absolute mortality kg
  expected: number;    // opening + purchased − supplied + posAdj − negAdj − mortality
  physical: number | null;    // physical closing for the day (if recorded)
  difference: number | null;  // physical − expected (null when no closing)
  status: "balanced" | "shortage" | "surplus" | "none";
};

const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyBreakdown = (): Record<ReasonKey, number> => ({});

const Inventory = () => {
  const { selectedDate, setSelectedDate } = useLedgerDate();
  const { adjustmentReasons } = useSettingsLists();
  const [meatFilter, setMeatFilter] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lossToday, setLossToday] = useState(0);
  const [lossWeek, setLossWeek] = useState(0);
  const [lossMonth, setLossMonth] = useState(0);
  const [reasonMetas, setReasonMetas] = useState<ReasonMeta[]>([]);

  // Maps for resolving reason names — includes archived reasons for historical rows.
  const reasonIdToLabel = useMemo(() => {
    const m = new Map<string, string>();
    adjustmentReasons.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [adjustmentReasons]);
  const reasonCodeToLabel = useMemo(() => {
    const m = new Map<string, string>();
    adjustmentReasons.forEach((r) => { if (r.code) m.set(r.code, r.name); });
    return m;
  }, [adjustmentReasons]);

  const load = useCallback(async () => {
    setLoading(true);

    const today = format(new Date(), "yyyy-MM-dd");
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

    // Opening = latest physical closing before selectedDate; fallback = cumulative before
    const [
      { data: prior },
      { data: p }, { data: s }, { data: adj },
      { data: pPrior }, { data: sPrior }, { data: adjPrior },
      { data: lossMonthRows },
      { data: closingsToday },
    ] = await Promise.all([
      supabase.from("stock_closings").select("meat_type, physical_stock, closing_date")
        .lt("closing_date", selectedDate).order("closing_date", { ascending: false }),
      supabase.from("purchases").select("meat_type, weight_kg").eq("purchase_date", selectedDate).is("reversed_at", null),
      supabase.from("supplies").select("meat_type, weight_kg").eq("supply_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg, reason, reason_id")
        .eq("adjustment_date", selectedDate).is("reversed_at", null).is("original_adjustment_id", null),
      supabase.from("purchases").select("meat_type, weight_kg").lt("purchase_date", selectedDate).is("reversed_at", null),
      supabase.from("supplies").select("meat_type, weight_kg").lt("supply_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg")
        .lt("adjustment_date", selectedDate).is("reversed_at", null).is("original_adjustment_id", null),
      // For summary cards (today/week/month totals of negative adjustments)
      supabase.from("stock_adjustments").select("quantity_kg, adjustment_date")
        .gte("adjustment_date", monthStart).lte("adjustment_date", today)
        .is("reversed_at", null).is("original_adjustment_id", null).lt("quantity_kg", 0),
      supabase.from("stock_closings").select("meat_type, physical_stock, status, reversed_at")
        .eq("closing_date", selectedDate).is("reversed_at", null),
    ]);

    const openingMap = new Map<string, number>();
    (prior ?? []).forEach((r: any) => {
      if (!openingMap.has(r.meat_type)) openingMap.set(r.meat_type, num(r.physical_stock));
    });

    const sumBy = (arr: any[] | null, key: string) => {
      const m = new Map<string, number>();
      (arr ?? []).forEach((r) => m.set(r[key], num(m.get(r[key])) + num(r.weight_kg ?? r.quantity_kg)));
      return m;
    };
    const pMap = sumBy(p ?? null, "meat_type");
    const sMap = sumBy(s ?? null, "meat_type");
    const pPriorMap = sumBy(pPrior ?? null, "meat_type");
    const sPriorMap = sumBy(sPrior ?? null, "meat_type");
    const aPriorMap = sumBy(adjPrior ?? null, "meat_type");

    // Adjustments today by meat_type & reason
    const breakdownMap = new Map<string, Record<ReasonKey, number>>();
    const netAdjToday = new Map<string, number>(); // signed sum (includes positives)
    const posAdjToday = new Map<string, number>();
    const negAdjToday = new Map<string, number>();
    const mortalityToday = new Map<string, number>();
    const seenReasons = new Map<string, string>(); // key -> label
    (adj ?? []).forEach((r: any) => {
      const mt = r.meat_type;
      const q = num(r.quantity_kg);
      netAdjToday.set(mt, num(netAdjToday.get(mt)) + q);
      const reasonCode = (r.reason ?? "").toLowerCase();
      if (reasonCode === "mortality") {
        mortalityToday.set(mt, num(mortalityToday.get(mt)) + Math.abs(q));
      } else if (q > 0) {
        posAdjToday.set(mt, num(posAdjToday.get(mt)) + q);
      } else if (q < 0) {
        negAdjToday.set(mt, num(negAdjToday.get(mt)) + Math.abs(q));
      }
      if (q < 0) {
        const b = breakdownMap.get(mt) ?? emptyBreakdown();
        const key: string = r.reason_id ?? r.reason ?? "unknown";
        const label =
          (r.reason_id && reasonIdToLabel.get(r.reason_id)) ||
          (r.reason && reasonCodeToLabel.get(r.reason)) ||
          (r.reason ? String(r.reason).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown");
        seenReasons.set(key, label);
        b[key] = round2(num(b[key]) + Math.abs(q));
        breakdownMap.set(mt, b);
      }
    });
    setReasonMetas(Array.from(seenReasons, ([key, label]) => ({ key, label })));

    const physicalMap = new Map<string, number>();
    (closingsToday ?? []).forEach((c: any) => {
      physicalMap.set(c.meat_type, num(c.physical_stock));
    });

    const types = new Set<string>(MEAT_TYPES as readonly string[]);
    [openingMap, pMap, sMap, pPriorMap, sPriorMap, aPriorMap, breakdownMap, netAdjToday]
      .forEach((m) => m.forEach((_, k) => types.add(k)));

    const nextRows: Row[] = [...types].sort().map((mt) => {
      const opening = openingMap.has(mt)
        ? round2(openingMap.get(mt) ?? 0)
        : round2((pPriorMap.get(mt) ?? 0) - (sPriorMap.get(mt) ?? 0) + (aPriorMap.get(mt) ?? 0));
      const purchased = round2(pMap.get(mt) ?? 0);
      const supplied = round2(sMap.get(mt) ?? 0);
      const breakdown = breakdownMap.get(mt) ?? emptyBreakdown();
      const loss = round2(Object.values(breakdown).reduce((a, b) => a + b, 0));
      // Current stock uses signed net adjustments (which include the negative losses)
      const current = round2(opening + purchased - supplied + (netAdjToday.get(mt) ?? 0));
      const posAdj = round2(posAdjToday.get(mt) ?? 0);
      const negAdj = round2(negAdjToday.get(mt) ?? 0);
      const mortality = round2(mortalityToday.get(mt) ?? 0);
      const expected = round2(opening + purchased - supplied + posAdj - negAdj - mortality);
      const physical = physicalMap.has(mt) ? round2(physicalMap.get(mt) ?? 0) : null;
      const difference = physical == null ? null : round2(physical - expected);
      const status: Row["status"] =
        physical == null ? "none"
        : Math.abs(difference ?? 0) < 0.001 ? "balanced"
        : (difference ?? 0) < 0 ? "shortage" : "surplus";
      return { meat_type: mt, opening, purchased, supplied, loss, current, breakdown, posAdj, negAdj, mortality, expected, physical, difference, status };
    }).filter(r => r.opening || r.purchased || r.supplied || r.loss || r.current || r.physical != null);

    setRows(nextRows);

    // Summary card totals
    let t = 0, w = 0, m = 0;
    (lossMonthRows ?? []).forEach((r: any) => {
      const abs = Math.abs(num(r.quantity_kg));
      m += abs;
      if (r.adjustment_date >= weekStart) w += abs;
      if (r.adjustment_date === today) t += abs;
    });
    setLossToday(round2(t));
    setLossWeek(round2(w));
    setLossMonth(round2(m));
    setLoading(false);
  }, [selectedDate, reasonIdToLabel, reasonCodeToLabel]);

  useEffect(() => { load(); }, [load]);

  // Realtime updates so no manual refresh is needed
  useEffect(() => {
    const ch = supabase
      .channel("inventory-live" + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "supplies" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_adjustments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_closings" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(
    () => meatFilter === "all" ? rows : rows.filter(r => r.meat_type === meatFilter),
    [rows, meatFilter]
  );

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    opening: acc.opening + r.opening,
    purchased: acc.purchased + r.purchased,
    supplied: acc.supplied + r.supplied,
    loss: acc.loss + r.loss,
    current: acc.current + r.current,
  }), { opening: 0, purchased: 0, supplied: 0, loss: 0, current: 0 }), [filtered]);

  const currentStockTotal = useMemo(
    () => round2(rows.reduce((a, r) => a + r.current, 0)),
    [rows]
  );

  const buildExportRows = () => {
    const out: any[] = [];
    filtered.forEach((r) => {
      const base: any = {
        "Meat Type": r.meat_type,
        "Opening (kg)": r.opening,
        "Purchased (kg)": r.purchased,
        "Supplied (kg)": r.supplied,
      };
      reasonMetas.forEach((rm) => { base[`${rm.label} (kg)`] = num(r.breakdown[rm.key]); });
      base["Inventory Loss (kg)"] = r.loss;
      base["Current Stock (kg)"] = r.current;
      out.push(base);
    });
    return out;
  };

  const doPrint = () => {
    printReport({
      title: "Inventory Report",
      subtitle: `As of ${selectedDate}`,
      dateLabel: selectedDate,
      columns: [
        { label: "Meat Type", value: (r: Row) => r.meat_type },
        { label: "Opening", value: (r: Row) => fmtKg(r.opening), align: "right" },
        { label: "Purchased", value: (r: Row) => fmtKg(r.purchased), align: "right" },
        { label: "Supplied", value: (r: Row) => fmtKg(r.supplied), align: "right" },
        { label: "Inventory Loss", value: (r: Row) => fmtKg(r.loss), align: "right" },
        { label: "Current Stock", value: (r: Row) => fmtKg(r.current), align: "right" },
      ],
      rows: filtered,
      totals: [
        { label: "Opening", value: fmtKg(totals.opening) },
        { label: "Purchased", value: fmtKg(totals.purchased) },
        { label: "Supplied", value: fmtKg(totals.supplied) },
        { label: "Inventory Loss", value: fmtKg(totals.loss) },
        { label: "Current Stock", value: fmtKg(totals.current) },
      ],
    });
  };

  const doExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(buildExportRows());
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `inventory_${selectedDate}.xlsx`);
  };

  const doPdf = () => {
    const pdf = new jsPDF({ orientation: "landscape" });
    pdf.setFontSize(14);
    pdf.text("Inventory Report", 14, 14);
    pdf.setFontSize(10);
    pdf.text(`As of ${selectedDate}`, 14, 20);
    autoTable(pdf, {
      startY: 26,
      head: [["Meat Type", "Opening", "Purchased", "Supplied", ...reasonMetas.map((r) => r.label), "Loss", "Current"]],
      body: filtered.map((r) => [
        r.meat_type,
        fmtKg(r.opening), fmtKg(r.purchased), fmtKg(r.supplied),
        ...reasonMetas.map((rm) => fmtKg(num(r.breakdown[rm.key]))),
        fmtKg(r.loss), fmtKg(r.current),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [40, 40, 40] },
    });
    pdf.save(`inventory_${selectedDate}.pdf`);
  };

  const toggle = (mt: string) => setExpanded((e) => ({ ...e, [mt]: !e[mt] }));

  const KpiCard = ({ title, value, icon: Icon, tone }: any) => (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`h-8 w-8 rounded-md flex items-center justify-center ${tone}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent><div className="text-2xl font-bold">{value}</div></CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <SeoHead title="Inventory" description="Real-time current stock, inventory loss breakdown and reports." path="/inventory" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Current Stock = Opening + Purchases − Supplies − Inventory Loss
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Current Stock" value={fmtKg(currentStockTotal)} icon={Boxes} tone="bg-emerald-500" />
        <KpiCard title="Today's Inventory Loss" value={fmtKg(lossToday)} icon={PackageMinus} tone="bg-red-500" />
        <KpiCard title="This Week Loss" value={fmtKg(lossWeek)} icon={CalendarDays} tone="bg-orange-500" />
        <KpiCard title="This Month Loss" value={fmtKg(lossMonth)} icon={CalendarRange} tone="bg-amber-500" />
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-end justify-between">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Date</label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-[170px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Meat Type</label>
              <Select value={meatFilter} onValueChange={setMeatFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {[...new Set([...MEAT_TYPES, ...rows.map(r => r.meat_type)])].map((mt) => (
                    <SelectItem key={mt} value={mt}>{mt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={doPrint}><Printer className="h-4 w-4" />Print</Button>
            <Button variant="outline" size="sm" onClick={doExcel}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
            <Button variant="outline" size="sm" onClick={doPdf}><FileText className="h-4 w-4" />PDF</Button>
          </div>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Meat Type</TableHead>
                <TableHead className="text-end">Opening</TableHead>
                <TableHead className="text-end">Purchased</TableHead>
                <TableHead className="text-end">Supplied</TableHead>
                <TableHead className="text-end">Inventory Loss</TableHead>
                <TableHead className="text-end">Current Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  <Boxes className="h-8 w-8 mx-auto mb-2 opacity-40" />No stock records for this date.
                </TableCell></TableRow>
              ) : (
                filtered.map((r) => {
                  const isOpen = !!expanded[r.meat_type];
                  return (
                    <Fragment key={r.meat_type}>
                      <TableRow>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggle(r.meat_type)}>
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{r.meat_type}</TableCell>
                        <TableCell className="text-end">{fmtKg(r.opening)}</TableCell>
                        <TableCell className="text-end">{fmtKg(r.purchased)}</TableCell>
                        <TableCell className="text-end">{fmtKg(r.supplied)}</TableCell>
                        <TableCell className={`text-end ${r.loss > 0 ? "text-destructive font-medium" : ""}`}>{fmtKg(r.loss)}</TableCell>
                        <TableCell className={`text-end font-semibold ${r.current < 0 ? "text-destructive" : ""}`}>{fmtKg(r.current)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={r.meat_type + "-b"} className="bg-muted/40">
                          <TableCell />
                          <TableCell colSpan={6}>
                            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <TrendingDown className="h-3 w-3" /> Loss Breakdown — {r.meat_type}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                              {(reasonMetas.length > 0 ? reasonMetas : []).map((rs) => (
                                <div key={rs.key} className="rounded border bg-background px-2 py-1.5">
                                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{rs.label}</div>
                                  <div className="text-sm font-medium">{fmtKg(num(r.breakdown[rs.key]))}</div>
                                </div>
                              ))}
                              <div className="rounded border bg-destructive/10 px-2 py-1.5">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Loss</div>
                                <div className="text-sm font-semibold text-destructive">{fmtKg(r.loss)}</div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
              {filtered.length > 0 && (
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell />
                  <TableCell>Totals</TableCell>
                  <TableCell className="text-end">{fmtKg(totals.opening)}</TableCell>
                  <TableCell className="text-end">{fmtKg(totals.purchased)}</TableCell>
                  <TableCell className="text-end">{fmtKg(totals.supplied)}</TableCell>
                  <TableCell className="text-end">{fmtKg(totals.loss)}</TableCell>
                  <TableCell className="text-end">{fmtKg(totals.current)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};

export default Inventory;
