import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Pencil, Ban } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/constants";
import { fetchPosSales, posTotals, type PosSaleRow } from "@/lib/posSales";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";

/** Invoices for the selected day with View / Edit / Void. Void keeps the record and returns stock. */
export function RecentInvoices({ date }: { date: string }) {
  const navigate = useNavigate();
  const { isOwner, can } = usePermissions();
  const { isSuperAdmin } = useAuth();
  const canVoid = isOwner || isSuperAdmin || can("pos", "delete") || can("pos", "reverse");
  const [rows, setRows] = useState<PosSaleRow[]>([]);
  const [target, setTarget] = useState<PosSaleRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setRows(await fetchPosSales(date, date)), [date]);
  useEffect(() => { load(); }, [load]);

  const doVoid = async () => {
    if (!target) return;
    if (!reason.trim()) return toast.error("Enter a reason");
    setBusy(true);
    const { error } = await (supabase as any).rpc("void_pos_sale", { p_id: target.id, p_reason: reason.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Invoice #${target.invoice_no} voided — stock returned`);
    setTarget(null); setReason(""); load();
  };

  const t = posTotals(rows);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Invoices on {date}</div>
        <div className="text-sm text-muted-foreground">{t.count} active · Sales {fmtMoney(t.total)} · Due {fmtMoney(t.due)}</div>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead><TableHead>Items</TableHead>
              <TableHead className="text-end">Total</TableHead><TableHead className="text-end">Paid</TableHead>
              <TableHead className="text-end">Due</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No invoices on this day</TableCell></TableRow>
            ) : rows.map((s) => (
              <TableRow key={s.id} className={s.voided_at ? "opacity-60" : ""}>
                <TableCell className="font-medium">#{s.invoice_no}</TableCell>
                <TableCell className="text-xs">{(s.pos_sale_items ?? []).map((i) => `${i.meat_type} ${Number(i.weight_kg)}kg`).join(", ")}</TableCell>
                <TableCell className="text-end">{fmtMoney(Number(s.total))}</TableCell>
                <TableCell className="text-end">{fmtMoney(Number(s.paid))}</TableCell>
                <TableCell className="text-end">{fmtMoney(Number(s.due))}</TableCell>
                <TableCell>{s.voided_at ? <Badge variant="destructive" title={s.void_reason ?? ""}>Void</Badge> : <Badge variant="secondary">Active</Badge>}</TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" title="View" onClick={() => navigate(`/invoice/${s.id}`)}><Eye className="h-4 w-4" /></Button>
                    {canVoid && !s.voided_at && (
                      <>
                        <Button size="icon" variant="ghost" title="Edit" onClick={() => navigate(`/pos?edit=${s.id}`)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="Void" onClick={() => setTarget(s)}><Ban className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void invoice #{target?.invoice_no}?</DialogTitle>
            <DialogDescription>The invoice stays in history marked Void. Its stock is returned and it no longer counts in sales, profit or dues.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1"><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doVoid} disabled={busy}>{busy ? "Voiding…" : "Void invoice"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
