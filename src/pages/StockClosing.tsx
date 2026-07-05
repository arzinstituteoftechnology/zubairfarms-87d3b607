import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEAT_TYPES, fmtKg } from "@/lib/constants";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { toast } from "sonner";
import { Save, Printer, History, Undo2 } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";
import { ReverseTransactionDialog } from "@/components/ReverseTransactionDialog";

type Reason = "weight_loss" | "mortality" | "wastage" | "damage" | "theft" | "other";
const REASONS: { value: Reason; label: string }[] = [
  { value: "weight_loss", label: "Weight Loss" },
  { value: "mortality", label: "Mortality" },
  { value: "wastage", label: "Wastage" },
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft" },
  { value: "other", label: "Other" },
];

type Row = {
  meat_type: string;
  opening: number;
  openingSource: "closing" | "calculated";
  purchases: number;
  supplies: number;
  adjustments: number;
  system: number;
  physical: string; // input
  reason: Reason | "";
  notes: string;
  closingId?: string;
  saving?: boolean;
};

type Adjustment = {
  id: string;
  adjustment_date: string;
  meat_type: string;
  quantity_kg: number;
  reason: Reason;
  notes: string | null;
  created_at: string;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  original_adjustment_id?: string | null;
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

const StockClosing = () => {
  const { selectedDate } = useLedgerDate();
  const { user, tenant } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<Adjustment[]>([]);
  const [reverseTarget, setReverseTarget] = useState<Adjustment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    // Latest physical closing per meat_type BEFORE selectedDate → opening stock
    const { data: prior } = await supabase
      .from("stock_closings")
      .select("meat_type, physical_stock, closing_date")
      .lt("closing_date", selectedDate)
      .order("closing_date", { ascending: false });

    const openingMap = new Map<string, number>();
    const openingSourceMap = new Map<string, "closing" | "calculated">();
    (prior ?? []).forEach((r: any) => {
      if (!openingMap.has(r.meat_type)) {
        openingMap.set(r.meat_type, num(r.physical_stock));
        openingSourceMap.set(r.meat_type, "closing");
      }
    });

    const [{ data: p }, { data: s }, { data: adj }, { data: existing }, { data: pPrior }, { data: sPrior }, { data: adjPrior }] = await Promise.all([
      supabase.from("purchases").select("meat_type, weight_kg").eq("purchase_date", selectedDate),
      supabase.from("supplies").select("meat_type, weight_kg").eq("supply_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg").eq("adjustment_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_closings").select("*").eq("closing_date", selectedDate),
      // Fallback opening: cumulative purchases/supplies/adjustments BEFORE selectedDate
      supabase.from("purchases").select("meat_type, weight_kg").lt("purchase_date", selectedDate),
      supabase.from("supplies").select("meat_type, weight_kg").lt("supply_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg").lt("adjustment_date", selectedDate).is("reversed_at", null),
    ]);

    const sumBy = (arr: any[] | null, kType: string, kVal: string) => {
      const m = new Map<string, number>();
      (arr ?? []).forEach((r) => m.set(r[kType], num(m.get(r[kType])) + num(r[kVal])));
      return m;
    };
    const pMap = sumBy(p ?? null, "meat_type", "weight_kg");
    const sMap = sumBy(s ?? null, "meat_type", "weight_kg");
    const aMap = sumBy(adj ?? null, "meat_type", "quantity_kg");
    const pPriorMap = sumBy(pPrior ?? null, "meat_type", "weight_kg");
    const sPriorMap = sumBy(sPrior ?? null, "meat_type", "weight_kg");
    const aPriorMap = sumBy(adjPrior ?? null, "meat_type", "quantity_kg");
    const existingMap = new Map<string, any>();
    (existing ?? []).forEach((r: any) => existingMap.set(r.meat_type, r));

    // Discovered meat types = configured + any that already have data
    const types = new Set<string>(MEAT_TYPES as readonly string[]);
    pMap.forEach((_, k) => types.add(k));
    sMap.forEach((_, k) => types.add(k));
    openingMap.forEach((_, k) => types.add(k));
    existingMap.forEach((_, k) => types.add(k));
    pPriorMap.forEach((_, k) => types.add(k));
    sPriorMap.forEach((_, k) => types.add(k));

    const nextRows: Row[] = [...types].sort().map((mt) => {
      let opening: number;
      let openingSource: "closing" | "calculated";
      if (openingMap.has(mt)) {
        opening = round2(openingMap.get(mt) ?? 0);
        openingSource = "closing";
      } else {
        // No prior closing → keep using the current stock calculation
        opening = round2((pPriorMap.get(mt) ?? 0) - (sPriorMap.get(mt) ?? 0) + (aPriorMap.get(mt) ?? 0));
        openingSource = "calculated";
      }
      const purchases = round2(pMap.get(mt) ?? 0);
      const supplies = round2(sMap.get(mt) ?? 0);
      const adjustments = round2(aMap.get(mt) ?? 0);
      const system = round2(opening + purchases - supplies + adjustments);
      const ex = existingMap.get(mt);
      return {
        meat_type: mt,
        opening, openingSource, purchases, supplies, adjustments, system,
        physical: ex ? String(num(ex.physical_stock)) : "",
        reason: (ex?.reason as Reason) ?? "",
        notes: ex?.notes ?? "",
        closingId: ex?.id,
      };
    });
    setRows(nextRows);

    const { data: auditRows } = await supabase
      .from("stock_adjustments")
      .select("id, adjustment_date, meat_type, quantity_kg, reason, notes, created_at, reversed_at, reversal_reason, original_adjustment_id")
      .eq("adjustment_date", selectedDate)
      .order("created_at", { ascending: false });
    setAudit((auditRows ?? []) as Adjustment[]);

    setLoading(false);
  }, [selectedDate]);

  useEffect(() => { load(); }, [load]);

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const saveRow = async (i: number) => {
    const r = rows[i];
    if (r.physical === "" || isNaN(Number(r.physical))) {
      toast.error("Enter physical stock");
      return;
    }
    const physical = round2(Number(r.physical));
    const difference = round2(physical - r.system);
    if (Math.abs(difference) > 0.001 && !r.reason) {
      toast.error("Select an adjustment reason for the difference");
      return;
    }
    updateRow(i, { saving: true });

    const payload = {
      tenant_id: tenant?.id,
      closing_date: selectedDate,
      meat_type: r.meat_type,
      opening_stock: r.opening,
      purchases_kg: r.purchases,
      supplies_kg: r.supplies,
      adjustments_kg: r.adjustments,
      system_stock: r.system,
      physical_stock: physical,
      difference,
      reason: Math.abs(difference) > 0.001 && r.reason ? (r.reason as Reason) : null,
      notes: r.notes || null,
      created_by: user?.id ?? null,
    };

    const { data: saved, error } = await supabase
      .from("stock_closings")
      .upsert(payload, { onConflict: "tenant_id,closing_date,meat_type" })
      .select()
      .single();

    if (error) {
      toast.error(error.message);
      updateRow(i, { saving: false });
      return;
    }

    // Write audit adjustment when non-zero difference
    if (Math.abs(difference) > 0.001 && r.reason) {
      const { error: aErr } = await supabase.from("stock_adjustments").insert({
        tenant_id: tenant?.id,
        adjustment_date: selectedDate,
        meat_type: r.meat_type,
        quantity_kg: difference,
        reason: r.reason,
        notes: r.notes || null,
        closing_id: saved?.id ?? null,
        created_by: user?.id ?? null,
      });
      if (aErr) toast.error("Adjustment log failed: " + aErr.message);
    }

    toast.success(`${r.meat_type} closing saved`);
    updateRow(i, { saving: false, closingId: saved?.id });
    load();
  };

  return (
    <div className="space-y-6">
      <SeoHead
        title="Daily Closing Stock — MeatFlow"
        description="Enter physical closing stock and reconcile against system stock with adjustment reasons and audit trail."
        path="/stock-closing"
      />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily Closing Stock</h1>
        <p className="text-sm text-muted-foreground">
          Enter the actual physical stock at end of day. Any difference creates an audited adjustment. Tomorrow&apos;s opening = today&apos;s physical stock.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Reconciliation — {selectedDate}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meat Type</TableHead>
                  <TableHead className="text-end">Opening</TableHead>
                  <TableHead className="text-end">Purchases</TableHead>
                  <TableHead className="text-end">Supplies</TableHead>
                  <TableHead className="text-end">System Stock</TableHead>
                  <TableHead className="text-end">Physical Stock</TableHead>
                  <TableHead className="text-end">Difference</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No meat types configured.</TableCell></TableRow>
                ) : rows.map((r, i) => {
                  const physicalNum = r.physical === "" ? null : Number(r.physical);
                  const diff = physicalNum == null || isNaN(physicalNum) ? null : round2(physicalNum - r.system);
                  const diffClass = diff == null ? "" : diff < 0 ? "text-destructive font-semibold" : diff > 0 ? "text-success font-semibold" : "";
                  return (
                    <TableRow key={r.meat_type}>
                      <TableCell className="font-medium">{r.meat_type}</TableCell>
                      <TableCell className="text-end">{fmtKg(r.opening)}</TableCell>
                      <TableCell className="text-end">{fmtKg(r.purchases)}</TableCell>
                      <TableCell className="text-end">{fmtKg(r.supplies)}</TableCell>
                      <TableCell className="text-end">{fmtKg(r.system)}</TableCell>
                      <TableCell className="text-end">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 w-28 text-end force-ltr"
                          value={r.physical}
                          onChange={(e) => updateRow(i, { physical: e.target.value })}
                          placeholder="0.00"
                        />
                      </TableCell>
                      <TableCell className={`text-end ${diffClass}`}>{diff == null ? "—" : fmtKg(diff)}</TableCell>
                      <TableCell>
                        <Select
                          value={r.reason || undefined}
                          onValueChange={(v) => updateRow(i, { reason: v as Reason })}
                          disabled={diff != null && Math.abs(diff) < 0.001}
                        >
                          <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            {REASONS.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-40"
                          value={r.notes}
                          onChange={(e) => updateRow(i, { notes: e.target.value })}
                          placeholder="Optional"
                        />
                      </TableCell>
                      <TableCell className="text-end">
                        <Button size="sm" onClick={() => saveRow(i)} disabled={!!r.saving}>
                          <Save className="h-4 w-4 mr-1" />
                          {r.closingId ? "Update" : "Save"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Adjustment Audit Trail — {selectedDate}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Meat Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-end">Quantity</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No adjustments recorded.</TableCell></TableRow>
                ) : audit.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-medium">{a.meat_type}</TableCell>
                    <TableCell>{REASONS.find((x) => x.value === a.reason)?.label ?? a.reason}</TableCell>
                    <TableCell className={`text-end font-semibold ${a.quantity_kg < 0 ? "text-destructive" : "text-success"}`}>
                      {a.quantity_kg > 0 ? "+" : ""}{fmtKg(a.quantity_kg)}
                    </TableCell>
                    <TableCell className="text-sm">{a.notes ?? "—"}</TableCell>
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

export default StockClosing;