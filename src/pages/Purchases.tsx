import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CrudPage } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MEAT_TYPES, fmtKg, fmtMoney } from "@/lib/constants";
import { format } from "date-fns";

type Row = {
  id: string; farm_id: string; meat_type: string; weight_kg: number; rate_per_kg: number;
  total_amount: number; purchase_date: string; notes: string | null;
  paid_amount: number; payment_method: string;
  farms?: { name: string } | null;
};

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = () => ({ farm_id: "", meat_type: "Beef", weight_kg: "", rate_per_kg: "", purchase_date: today(), notes: "", paid_amount: "", payment_method: "credit" });

const Purchases = () => {
  const { role, user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const [editing, setEditing] = useState<Row | null>(null);
  const [delTarget, setDelTarget] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, fr] = await Promise.all([
      supabase.from("purchases").select("*, farms(name)").order("purchase_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("farms").select("id, name").order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setFarms((fr.data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.farm_id || !form.weight_kg || !form.rate_per_kg) return toast.error("Farm, weight and rate are required");
    const total = (Number(form.weight_kg) || 0) * (Number(form.rate_per_kg) || 0);
    const paid = form.payment_method === "credit" ? 0 : (Number(form.paid_amount) || (form.payment_method === "cash" || form.payment_method === "bank" ? total : 0));
    const payload = {
      farm_id: form.farm_id, meat_type: form.meat_type,
      weight_kg: Number(form.weight_kg), rate_per_kg: Number(form.rate_per_kg),
      purchase_date: form.purchase_date, notes: form.notes || null,
      paid_amount: paid, payment_method: form.payment_method,
    };
    const op = editing
      ? supabase.from("purchases").update(payload).eq("id", editing.id)
      : supabase.from("purchases").insert({ ...payload, created_by: user?.id });
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success(editing ? "Purchase updated" : "Purchase recorded");
    setOpen(false); load();
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("purchases").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDelTarget(null);
  };

  return (
    <>
      <CrudPage<Row>
        title="Purchases"
        subtitle="Daily meat/livestock purchases from farms"
        rows={rows} loading={loading}
        searchKeys={["meat_type"]}
        onAdd={() => { setEditing(null); setForm(emptyForm()); setOpen(true); }}
        addLabel="Record purchase"
        columns={[
          { key: "date", label: "Date", render: (r) => r.purchase_date },
          { key: "farm", label: "Farm", render: (r) => <span className="font-medium">{r.farms?.name ?? "—"}</span> },
          { key: "meat", label: "Meat", render: (r) => r.meat_type },
          { key: "weight", label: "Weight", className: "text-right", render: (r) => fmtKg(r.weight_kg) },
          { key: "rate", label: "Rate/kg", className: "text-right", render: (r) => fmtMoney(r.rate_per_kg) },
          { key: "total", label: "Total", className: "text-right font-medium", render: (r) => fmtMoney(r.total_amount) },
          { key: "paid", label: "Paid", className: "text-right", render: (r) => <span className="text-success">{fmtMoney(r.paid_amount)}</span> },
          { key: "bal", label: "Balance", className: "text-right", render: (r) => {
            const bal = Number(r.total_amount) - Number(r.paid_amount);
            return <span className={bal > 0 ? "text-destructive font-semibold" : "text-success"}>{fmtMoney(bal)}</span>;
          }},
          { key: "method", label: "Method", render: (r) => <span className="text-xs uppercase">{r.payment_method}</span> },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...r, purchase_date: r.purchase_date, weight_kg: String(r.weight_kg), rate_per_kg: String(r.rate_per_kg), paid_amount: String(r.paid_amount ?? 0), payment_method: r.payment_method ?? "credit" }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit purchase" : "Record purchase"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
              <div><Label>Farm *</Label>
                <Select value={form.farm_id} onValueChange={(v) => setForm({ ...form, farm_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select farm" /></SelectTrigger>
                  <SelectContent>{farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Meat type</Label>
                <Select value={form.meat_type} onValueChange={(v) => setForm({ ...form, meat_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Weight (kg) *</Label><Input type="number" step="0.001" min="0" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} /></div>
              <div><Label>Rate/kg *</Label><Input type="number" step="0.01" min="0" value={form.rate_per_kg} onChange={(e) => setForm({ ...form, rate_per_kg: e.target.value })} /></div>
            </div>
            <div className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">{fmtMoney((Number(form.weight_kg) || 0) * (Number(form.rate_per_kg) || 0))}</span></div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div><Label>Payment method</Label>
                <Select value={form.payment_method} onValueChange={(v) => {
                  const total = (Number(form.weight_kg) || 0) * (Number(form.rate_per_kg) || 0);
                  setForm({ ...form, payment_method: v, paid_amount: v === "credit" ? "0" : v === "partial" ? form.paid_amount : String(total.toFixed(2)) });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Udhaar (Credit)</SelectItem>
                    <SelectItem value="cash">Naqd (Cash)</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Paid now</Label>
                <Input type="number" step="0.01" min="0" value={form.paid_amount}
                  disabled={form.payment_method === "credit"}
                  onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
              </div>
            </div>
            {(() => {
              const total = (Number(form.weight_kg) || 0) * (Number(form.rate_per_kg) || 0);
              const paid = form.payment_method === "credit" ? 0 : Number(form.paid_amount) || 0;
              const bal = total - paid;
              return <div className="text-sm flex justify-between bg-muted/40 rounded-md px-3 py-2">
                <span>Balance (udhaar): <b className={bal > 0 ? "text-destructive" : "text-success"}>{fmtMoney(bal)}</b></span>
              </div>;
            })()}
            <div><Label>Notes</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete purchase?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Purchases;