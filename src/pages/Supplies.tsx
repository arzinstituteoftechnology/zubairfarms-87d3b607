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
  id: string; shop_id: string; meat_type: string; weight_kg: number; rate_per_kg: number;
  cost_per_kg: number; total_amount: number; supply_date: string; notes: string | null;
  shops?: { name: string } | null;
};

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = () => ({ shop_id: "", meat_type: "Beef", weight_kg: "", rate_per_kg: "", cost_per_kg: "", supply_date: today(), notes: "" });

const Supplies = () => {
  const { role, user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm());
  const [editing, setEditing] = useState<Row | null>(null);
  const [delTarget, setDelTarget] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, sh] = await Promise.all([
      supabase.from("supplies").select("*, shops(name)").order("supply_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("shops").select("id, name").order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setShops((sh.data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Auto-fill cost_per_kg from latest purchase of same meat type
  useEffect(() => {
    if (!form.meat_type || editing) return;
    supabase.from("purchases").select("rate_per_kg").eq("meat_type", form.meat_type)
      .order("purchase_date", { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0] && !form.cost_per_kg) setForm((f: any) => ({ ...f, cost_per_kg: String(data[0].rate_per_kg) }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.meat_type, editing]);

  const save = async () => {
    if (!form.shop_id || !form.weight_kg || !form.rate_per_kg) return toast.error("Shop, weight and rate are required");
    const payload = {
      shop_id: form.shop_id, meat_type: form.meat_type,
      weight_kg: Number(form.weight_kg), rate_per_kg: Number(form.rate_per_kg),
      cost_per_kg: Number(form.cost_per_kg) || 0,
      supply_date: form.supply_date, notes: form.notes || null,
    };
    const op = editing
      ? supabase.from("supplies").update(payload).eq("id", editing.id)
      : supabase.from("supplies").insert({ ...payload, created_by: user?.id });
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success(editing ? "Supply updated" : "Supply recorded");
    setOpen(false); load();
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("supplies").delete().eq("id", delTarget.id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
    setDelTarget(null);
  };

  const w = Number(form.weight_kg) || 0;
  const r = Number(form.rate_per_kg) || 0;
  const c = Number(form.cost_per_kg) || 0;
  const profit = w * (r - c);

  return (
    <>
      <CrudPage<Row>
        title="Supplies"
        subtitle="Daily meat supplied to shops"
        rows={rows} loading={loading}
        searchKeys={["meat_type"]}
        onAdd={() => { setEditing(null); setForm(emptyForm()); setOpen(true); }}
        addLabel="Record supply"
        columns={[
          { key: "date", label: "Date", render: (r) => r.supply_date },
          { key: "shop", label: "Shop", render: (r) => <span className="font-medium">{r.shops?.name ?? "—"}</span> },
          { key: "meat", label: "Meat", render: (r) => r.meat_type },
          { key: "weight", label: "Weight", className: "text-right", render: (r) => fmtKg(r.weight_kg) },
          { key: "rate", label: "Rate/kg", className: "text-right", render: (r) => fmtMoney(r.rate_per_kg) },
          { key: "total", label: "Total", className: "text-right font-medium", render: (r) => fmtMoney(r.total_amount) },
          { key: "actions", label: "", className: "text-right w-24", render: (r) => (
            <div className="flex justify-end gap-1">
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...r, weight_kg: String(r.weight_kg), rate_per_kg: String(r.rate_per_kg), cost_per_kg: String(r.cost_per_kg) }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDelTarget(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit supply" : "Record supply"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.supply_date} onChange={(e) => setForm({ ...form, supply_date: e.target.value })} /></div>
              <div><Label>Shop *</Label>
                <Select value={form.shop_id} onValueChange={(v) => setForm({ ...form, shop_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select shop" /></SelectTrigger>
                  <SelectContent>{shops.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Meat type</Label>
                <Select value={form.meat_type} onValueChange={(v) => setForm({ ...form, meat_type: v, cost_per_kg: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Weight (kg) *</Label><Input type="number" step="0.001" min="0" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Sale rate/kg *</Label><Input type="number" step="0.01" min="0" value={form.rate_per_kg} onChange={(e) => setForm({ ...form, rate_per_kg: e.target.value })} /></div>
              <div><Label>Cost/kg (for profit)</Label><Input type="number" step="0.01" min="0" value={form.cost_per_kg} onChange={(e) => setForm({ ...form, cost_per_kg: e.target.value })} /></div>
            </div>
            <div className="text-sm flex justify-between bg-muted rounded-md px-3 py-2">
              <span>Total: <span className="font-semibold text-foreground">{fmtMoney(w * r)}</span></span>
              <span>Profit: <span className={`font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(profit)}</span></span>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete supply?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Supplies;