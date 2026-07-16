import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtKg } from "@/lib/constants";
import { useSettingsLists, activeOnly } from "@/hooks/useSettingsLists";
import { useLedgerDate } from "@/hooks/useLedgerDate";
import { toast } from "sonner";
import { Save, Printer, History, Undo2 } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";
import { ReverseTransactionDialog } from "@/components/ReverseTransactionDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Info, CheckCircle2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Reason = string;
// Reasons available when Physical < Expected (stock is missing)
const SHORTAGE_REASONS: { value: string; label: string }[] = [
  { value: "mortality", label: "Mortality" },
  { value: "weight_loss", label: "Weight Loss" },
  { value: "wastage", label: "Wastage" },
  { value: "leakage", label: "Leakage" },
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft" },
  { value: "scale_difference", label: "Scale Difference" },
  { value: "counting_difference", label: "Counting Difference" },
  { value: "purchase_entry_error", label: "Purchase Entry Error" },
  { value: "supply_entry_error", label: "Supply Entry Error" },
  { value: "opening_stock_correction", label: "Opening Stock Correction" },
  { value: "other", label: "Other" },
];
// Reasons available when Physical > Expected (extra stock)
const SURPLUS_REASONS: { value: string; label: string }[] = [
  { value: "weight_gain", label: "Weight Gain" },
  { value: "scale_difference", label: "Scale Difference" },
  { value: "moisture_gain", label: "Moisture Gain" },
  { value: "purchase_under_recorded", label: "Purchase Under-recorded" },
  { value: "supply_over_recorded", label: "Supply Over-recorded" },
  { value: "counting_difference", label: "Counting Difference" },
  { value: "measurement_correction", label: "Measurement Correction" },
  { value: "opening_stock_correction", label: "Opening Stock Correction" },
  { value: "previous_closing_correction", label: "Previous Closing Correction" },
  { value: "other", label: "Other" },
];
const ALL_REASONS = [...SHORTAGE_REASONS, ...SURPLUS_REASONS];

type Row = {
  meat_type: string;
  opening: number;
  openingSource: "closing" | "calculated";
  purchases: number;
  supplies: number;
  adjustments: number;
  mortality: number;             // absolute kg (from mortality adjustments)
  positiveAdjustments: number;   // sum of quantity_kg > 0 (excluding mortality)
  negativeAdjustments: number;   // sum of quantity_kg < 0 (absolute, excluding mortality)
  system: number;
  physical: string; // input
  reason: Reason | "";
  notes: string;
  farm_id?: string | null;
  shop_id?: string | null;
  bird_count?: string; // input as string
  closingId?: string;
  status?: "draft" | "finalized";
  reversed?: boolean;
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
  const { user, tenant, role, isSuperAdmin } = useAuth();
  const { meatTypes, adjustmentReasons } = useSettingsLists();
  // Custom tenant-defined reasons (if any) are merged so both the shortage/surplus
  // curated lists AND any tenant-specific reasons remain available.
  const CUSTOM_REASONS = activeOnly(adjustmentReasons).map(r => ({ value: r.code, label: r.name, id: r.id }));
  const REASON_LABEL: Record<string, string> = {
    ...Object.fromEntries(ALL_REASONS.map(r => [r.value, r.label])),
    ...Object.fromEntries((adjustmentReasons ?? []).map(r => [r.code, r.name])),
  };
  const reasonIdFor = (code: string) =>
    CUSTOM_REASONS.find(x => x.value === code)?.id ?? null;
  // Backwards-compat merged reasons list used for lookups and legacy dropdowns
  const REASONS: { value: string; label: string; id?: string | null }[] = [
    ...CUSTOM_REASONS,
    ...ALL_REASONS.filter(r => !CUSTOM_REASONS.some(c => c.value === r.value)),
  ];
  // Diff-aware reason picker: shortage list when Physical < Expected, surplus list when >
  const reasonsForDiff = (diff: number | null): { value: string; label: string }[] => {
    if (diff == null || Math.abs(diff) < 0.001) return [];
    const base = diff < 0 ? SHORTAGE_REASONS : SURPLUS_REASONS;
    // Append any tenant-custom reasons the base list doesn't already include
    const extras = CUSTOM_REASONS
      .filter(c => !base.some(b => b.value === c.value))
      .map(c => ({ value: c.value, label: c.label }));
    return [...base, ...extras];
  };
  const ACTIVE_MEATS = activeOnly(meatTypes).map(m => m.name);
  const canReverse = role === "admin" || isSuperAdmin;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<Adjustment[]>([]);
  const [reverseTarget, setReverseTarget] = useState<Adjustment | null>(null);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: f }, { data: s }] = await Promise.all([
        supabase.from("farms").select("id, name").order("name"),
        supabase.from("shops").select("id, name").order("name"),
      ]);
      setFarms((f ?? []) as any);
      setShops((s ?? []) as any);
    })();
  }, []);

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
      supabase.from("purchases").select("meat_type, weight_kg").eq("purchase_date", selectedDate).is("reversed_at", null),
      supabase.from("supplies").select("meat_type, weight_kg").eq("supply_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg, reason").eq("adjustment_date", selectedDate).is("reversed_at", null).is("original_adjustment_id", null).is("closing_id", null),
      supabase.from("stock_closings").select("*").eq("closing_date", selectedDate),
      // Fallback opening: cumulative purchases/supplies/adjustments BEFORE selectedDate
      // (reversed rows must NOT contribute to stock — audit only)
      supabase.from("purchases").select("meat_type, weight_kg").lt("purchase_date", selectedDate).is("reversed_at", null),
      supabase.from("supplies").select("meat_type, weight_kg").lt("supply_date", selectedDate).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg").lt("adjustment_date", selectedDate).is("reversed_at", null).is("original_adjustment_id", null),
    ]);

    const sumBy = (arr: any[] | null, kType: string, kVal: string) => {
      const m = new Map<string, number>();
      (arr ?? []).forEach((r) => m.set(r[kType], num(m.get(r[kType])) + num(r[kVal])));
      return m;
    };
    const pMap = sumBy(p ?? null, "meat_type", "weight_kg");
    const sMap = sumBy(s ?? null, "meat_type", "weight_kg");
    const aMap = sumBy(adj ?? null, "meat_type", "quantity_kg");
    // Split day's adjustments (excluding those already linked to a closing) into mortality / positive / negative
    const mortalityMap = new Map<string, number>();
    const posAdjMap = new Map<string, number>();
    const negAdjMap = new Map<string, number>();
    (adj ?? []).forEach((r: any) => {
      const mt = r.meat_type as string;
      const q = num(r.quantity_kg);
      if ((r.reason ?? "").toLowerCase() === "mortality") {
        mortalityMap.set(mt, num(mortalityMap.get(mt)) + Math.abs(q));
      } else if (q > 0) {
        posAdjMap.set(mt, num(posAdjMap.get(mt)) + q);
      } else if (q < 0) {
        negAdjMap.set(mt, num(negAdjMap.get(mt)) + Math.abs(q));
      }
    });
    const pPriorMap = sumBy(pPrior ?? null, "meat_type", "weight_kg");
    const sPriorMap = sumBy(sPrior ?? null, "meat_type", "weight_kg");
    const aPriorMap = sumBy(adjPrior ?? null, "meat_type", "quantity_kg");
    const existingMap = new Map<string, any>();
    (existing ?? []).forEach((r: any) => existingMap.set(r.meat_type, r));

    // Discovered meat types = configured + any that already have data
    const types = new Set<string>(ACTIVE_MEATS.length ? ACTIVE_MEATS : ["Beef","Mutton","Goat","Chicken","Lamb","Buffalo"]);
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
        mortality: round2(mortalityMap.get(mt) ?? 0),
        positiveAdjustments: round2(posAdjMap.get(mt) ?? 0),
        negativeAdjustments: round2(negAdjMap.get(mt) ?? 0),
        physical: ex ? String(num(ex.physical_stock)) : "",
        reason: (ex?.reason as Reason) ?? "",
        notes: ex?.notes ?? "",
        closingId: ex?.id,
        status: (ex?.status as "draft" | "finalized") ?? undefined,
        reversed: !!ex?.reversed_at,
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

  const requestSave = (i: number, targetStatus: "draft" | "finalized" = "draft") => {
    const r = rows[i];
    if (r.status === "finalized" || r.reversed) { toast.error("Closing is finalized/reversed — cannot edit"); return; }
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
    if (r.reason === "other" && !r.notes.trim()) {
      toast.error("Notes are required when reason is 'Other'");
      return;
    }
    setPendingStatus(targetStatus);
    setConfirmIdx(i);
  };

  const saveRow = async (i: number, targetStatus: "draft" | "finalized" = "draft") => {
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

    const varianceType: "balanced" | "shortage" | "surplus" =
      Math.abs(difference) < 0.001 ? "balanced" : difference < 0 ? "shortage" : "surplus";
    const payload: any = {
      tenant_id: tenant?.id,
      closing_date: selectedDate,
      meat_type: r.meat_type,
      opening_stock: r.opening,
      purchases_kg: r.purchases,
      supplies_kg: r.supplies,
      adjustments_kg: r.adjustments,
      mortality_weight: r.mortality,
      positive_adjustments_kg: r.positiveAdjustments,
      negative_adjustments_kg: r.negativeAdjustments,
      expected_closing_stock: r.system,
      variance_weight: difference,
      variance_type: varianceType,
      system_stock: r.system,
      physical_stock: physical,
      difference,
      status: targetStatus,
      finalized_at: targetStatus === "finalized" ? new Date().toISOString() : null,
      finalized_by: targetStatus === "finalized" ? (user?.id ?? null) : null,
      reason: Math.abs(difference) > 0.001 && r.reason ? (r.reason as any) : null,
      reason_id: Math.abs(difference) > 0.001 && r.reason
        ? (REASONS.find(x => x.value === r.reason)?.id ?? null)
        : null,
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
        reason: r.reason as any,
        reason_id: REASONS.find(x => x.value === r.reason)?.id ?? null,
        notes: r.notes || null,
        closing_id: saved?.id ?? null,
        created_by: user?.id ?? null,
        farm_id: r.farm_id || null,
        shop_id: r.shop_id || null,
        bird_count: r.bird_count && !isNaN(Number(r.bird_count)) ? Math.max(0, Math.trunc(Number(r.bird_count))) : null,
      });
      if (aErr) toast.error("Adjustment log failed: " + aErr.message);
    }

    toast.success(`${r.meat_type} closing saved. Tomorrow's opening stock will be ${fmtKg(physical)}.`);
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
          <div className="mb-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div className="space-y-0.5">
              <div><span className="font-semibold text-foreground">System Stock</span> = Expected stock according to transactions (Opening + Purchases − Supplies + Adjustments).</div>
              <div><span className="font-semibold text-foreground">Physical Stock</span> = Actual stock counted in freezer/shop.</div>
            </div>
          </div>
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
                  const diffClass =
                    diff == null ? "" :
                    diff === 0 ? "text-success font-semibold" :
                    diff > 0 ? "text-warning font-semibold" :
                    "text-destructive font-semibold";
                  const isZero = diff != null && Math.abs(diff) < 0.001;
                  return (
                    <TableRow key={r.meat_type}>
                      <TableCell className="font-medium">{r.meat_type}</TableCell>
                      <TableCell className="text-end">
                        {fmtKg(r.opening)}
                        {r.openingSource === "calculated" && (
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">calculated</div>
                        )}
                      </TableCell>
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
                      <TableCell className="text-center">
                        {diff == null ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : Math.abs(diff) < 0.001 ? (
                          <Badge variant="outline" className="text-success border-success/40">Balanced</Badge>
                        ) : diff < 0 ? (
                          <Badge variant="outline" className="text-destructive border-destructive/40">Shortage</Badge>
                        ) : (
                          <Badge variant="outline" className="text-warning border-warning/40">Surplus</Badge>
                        )}
                        {r.status === "finalized" && (
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 inline-flex items-center gap-1"><Lock className="h-2.5 w-2.5" /> finalized</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={isZero ? "__none__" : (r.reason || undefined)}
                          onValueChange={(v) => updateRow(i, { reason: v as Reason })}
                          disabled={isZero || r.status === "finalized" || r.reversed}
                        >
                          <SelectTrigger className="h-8 w-[160px]">
                            <SelectValue placeholder={isZero ? "None" : "Select reason"} />
                          </SelectTrigger>
                          <SelectContent>
                            {isZero && <SelectItem value="__none__">None</SelectItem>}
                            {reasonsForDiff(diff).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-40"
                          value={r.notes}
                          onChange={(e) => updateRow(i, { notes: e.target.value })}
                          placeholder="Optional"
                          disabled={r.status === "finalized" || r.reversed}
                        />
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center gap-2 justify-end">
                          {r.status !== "finalized" && !r.reversed && (
                            <Button size="sm" variant="outline" onClick={() => requestSave(i, "draft")} disabled={!!r.saving}>
                              <Save className="h-4 w-4 mr-1" />
                              {r.closingId ? "Update" : "Save Draft"}
                            </Button>
                          )}
                          {r.status !== "finalized" && !r.reversed && r.closingId && (
                            <Button size="sm" onClick={() => requestSave(i, "finalized")} disabled={!!r.saving}>
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Finalize
                            </Button>
                          )}
                          {r.status === "finalized" && (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Reverse to edit</span>
                          )}
                        </div>
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No adjustments recorded.</TableCell></TableRow>
                ) : audit.map((a) => (
                  <TableRow key={a.id} className={a.reversed_at ? "opacity-60" : ""}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-medium">{a.meat_type}</TableCell>
                    <TableCell>{REASON_LABEL[a.reason] ?? REASONS.find((x) => x.value === a.reason)?.label ?? a.reason}</TableCell>
                    <TableCell className={`text-end font-semibold ${a.quantity_kg < 0 ? "text-destructive" : "text-success"}`}>
                      {a.quantity_kg > 0 ? "+" : ""}{fmtKg(a.quantity_kg)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.notes ?? "—"}
                      {a.reversed_at && (
                        <div className="text-[10px] uppercase tracking-wider text-destructive mt-1">
                          Reversed{a.reversal_reason ? ` — ${a.reversal_reason}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {canReverse && !a.reversed_at && !a.original_adjustment_id && (
                        <Button size="sm" variant="outline" onClick={() => setReverseTarget(a)}>
                          <Undo2 className="h-3.5 w-3.5 mr-1" /> Reverse
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ReverseTransactionDialog
        open={!!reverseTarget}
        target={reverseTarget ? { label: `${reverseTarget.meat_type} adjustment`, amount: reverseTarget.quantity_kg, date: reverseTarget.adjustment_date } : null}
        onOpenChange={(o) => { if (!o) setReverseTarget(null); }}
        onConfirm={async (reason, notes) => {
          if (!reverseTarget) return;
          const { error } = await supabase.rpc("reverse_stock_adjustment", { p_id: reverseTarget.id, p_reason: reason, p_notes: notes || null });
          if (error) { toast.error(error.message); return; }
          toast.success("Adjustment reversed");
          setReverseTarget(null);
          load();
        }}
      />

      <AlertDialog open={confirmIdx !== null} onOpenChange={(o) => { if (!o) setConfirmIdx(null); }}>
        <AlertDialogContent>
          {confirmIdx !== null && (() => {
            const r = rows[confirmIdx];
            const physical = round2(Number(r.physical));
            const diff = round2(physical - r.system);
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm closing — {r.meat_type}</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 pt-2 text-sm">
                      <div className="flex justify-between"><span>System Stock</span><span className="font-mono">{fmtKg(r.system)}</span></div>
                      <div className="flex justify-between"><span>Physical Stock</span><span className="font-mono">{fmtKg(physical)}</span></div>
                      <div className="flex justify-between font-semibold">
                        <span>Difference</span>
                        <span className={`font-mono ${Math.abs(diff) < 0.001 ? "text-success" : diff > 0 ? "text-warning" : "text-destructive"}`}>
                          {diff > 0 ? "+" : ""}{fmtKg(diff)}
                        </span>
                      </div>
                      {Math.abs(diff) > 0.001 && r.reason && (
                        <div className="flex justify-between"><span>Adjustment Reason</span><span>{REASONS.find((x) => x.value === r.reason)?.label}</span></div>
                      )}
                      {r.reason === "mortality" && diff < -0.001 && (
                        <div className="pt-3 border-t space-y-2">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground">Mortality details (optional)</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-muted-foreground block mb-1">Farm</label>
                              <Select value={r.farm_id ?? "__none__"} onValueChange={(v) => updateRow(confirmIdx!, { farm_id: v === "__none__" ? null : v })}>
                                <SelectTrigger className="h-8"><SelectValue placeholder="Select farm" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— None —</SelectItem>
                                  {farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground block mb-1">Shop</label>
                              <Select value={r.shop_id ?? "__none__"} onValueChange={(v) => updateRow(confirmIdx!, { shop_id: v === "__none__" ? null : v })}>
                                <SelectTrigger className="h-8"><SelectValue placeholder="Select shop" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— None —</SelectItem>
                                  {shops.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-2">
                              <label className="text-xs text-muted-foreground block mb-1">Bird Count</label>
                              <Input
                                type="number"
                                min="0"
                                className="h-8 force-ltr"
                                value={r.bird_count ?? ""}
                                onChange={(e) => updateRow(confirmIdx!, { bird_count: e.target.value })}
                                placeholder="e.g. 12"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="pt-2 text-xs text-muted-foreground">
                        Tomorrow&apos;s opening stock for {r.meat_type} will be <span className="font-semibold text-foreground">{fmtKg(physical)}</span>.
                      </div>
                      <div className="pt-1">Do you want to save?</div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={(e) => { e.preventDefault(); const idx = confirmIdx; setConfirmIdx(null); if (idx !== null) saveRow(idx); }}>
                    Save Closing
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StockClosing;