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
import { Pencil, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import { fmtKg, fmtMoney } from "@/lib/constants";
import { format } from "date-fns";

type D = {
  id: string; truck_id: string | null; farm_id: string | null; destination: string | null;
  loading_date: string; loading_time: string | null; chickens_count: number; total_weight_kg: number;
  fuel_expense: number; labour_expense: number; other_expense: number; notes: string | null;
  trucks?: { number: string; driver_name: string | null } | null; farms?: { name: string } | null;
};
const empty = () => ({ truck_id: "", farm_id: "", destination: "", loading_date: format(new Date(), "yyyy-MM-dd"), loading_time: "", chickens_count: "0", total_weight_kg: "0", fuel_expense: "0", labour_expense: "0", other_expense: "0", notes: "" });

const Deliveries = () => {
  const { role, user } = useAuth();
  const [rows, setRows] = useState<D[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]); const [farms, setFarms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); const [form, setForm] = useState<any>(empty());
  const [editing, setEditing] = useState<D | null>(null); const [del, setDel] = useState<D | null>(null);
  const [printRow, setPrintRow] = useState<D | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, t, f] = await Promise.all([
      supabase.from("deliveries").select("*, trucks(number, driver_name), farms(name)").order("loading_date", { ascending: false }),
      supabase.from("trucks").select("id, number, driver_name").order("number"),
      supabase.from("farms").select("id, name").order("name"),
    ]);
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setTrucks(t.data ?? []); setFarms(f.data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const payload = {
      truck_id: form.truck_id || null, farm_id: form.farm_id || null, destination: form.destination || null,
      loading_date: form.loading_date, loading_time: form.loading_time || null,
      chickens_count: Number(form.chickens_count) || 0, total_weight_kg: Number(form.total_weight_kg) || 0,
      fuel_expense: Number(form.fuel_expense) || 0, labour_expense: Number(form.labour_expense) || 0, other_expense: Number(form.other_expense) || 0,
      notes: form.notes || null,
    };
    const op = editing ? supabase.from("deliveries").update(payload).eq("id", editing.id) : supabase.from("deliveries").insert({ ...payload, created_by: user?.id });
    const { error } = await op; if (error) return toast.error(error.message);
    toast.success("Saved"); setOpen(false); load();
  };
  const doDelete = async () => { if (!del) return; const { error } = await supabase.from("deliveries").delete().eq("id", del.id); if (error) toast.error(error.message); else { toast.success("Deleted"); load(); } setDel(null); };

  return (
    <>
      <CrudPage<D>
        title="Truck Deliveries" subtitle="Loading & delivery tracking"
        rows={rows} loading={loading} searchKeys={["destination"]}
        onAdd={() => { setEditing(null); setForm(empty()); setOpen(true); }} addLabel="New delivery"
        columns={[
          { key: "d", label: "Date", render: (r) => `${r.loading_date}${r.loading_time ? ` ${r.loading_time}` : ""}` },
          { key: "t", label: "Truck", render: (r) => r.trucks?.number ? <span className="font-medium">{r.trucks.number}{r.trucks.driver_name ? ` · ${r.trucks.driver_name}` : ""}</span> : "—" },
          { key: "f", label: "Farm", render: (r) => r.farms?.name || "—" },
          { key: "dest", label: "Destination", render: (r) => r.destination || "—" },
          { key: "c", label: "Chickens", className: "text-right", render: (r) => r.chickens_count },
          { key: "w", label: "Weight", className: "text-right", render: (r) => fmtKg(r.total_weight_kg) },
          { key: "exp", label: "Expenses", className: "text-right", render: (r) => fmtMoney(Number(r.fuel_expense) + Number(r.labour_expense) + Number(r.other_expense)) },
          { key: "actions", label: "", className: "text-right w-32", render: (r) => (
            <div className="flex justify-end gap-1">
              <Button size="icon" variant="ghost" onClick={() => setPrintRow(r)}><Printer className="h-4 w-4" /></Button>
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...r, truck_id: r.truck_id ?? "", farm_id: r.farm_id ?? "", chickens_count: String(r.chickens_count), total_weight_kg: String(r.total_weight_kg), fuel_expense: String(r.fuel_expense), labour_expense: String(r.labour_expense), other_expense: String(r.other_expense) }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
              {role === "admin" && <Button size="icon" variant="ghost" onClick={() => setDel(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </div>
          )},
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit delivery" : "New delivery"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Truck</Label>
                <Select value={form.truck_id || "__none"} onValueChange={(v) => setForm({ ...form, truck_id: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select truck" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">None</SelectItem>{trucks.map((t) => <SelectItem key={t.id} value={t.id}>{t.number}{t.driver_name ? ` · ${t.driver_name}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Farm</Label>
                <Select value={form.farm_id || "__none"} onValueChange={(v) => setForm({ ...form, farm_id: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select farm" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">None</SelectItem>{farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Loading date</Label><Input type="date" value={form.loading_date} onChange={(e) => setForm({ ...form, loading_date: e.target.value })} /></div>
              <div><Label>Loading time</Label><Input type="time" value={form.loading_time} onChange={(e) => setForm({ ...form, loading_time: e.target.value })} /></div>
              <div><Label>Destination</Label><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Chickens loaded</Label><Input type="number" value={form.chickens_count} onChange={(e) => setForm({ ...form, chickens_count: e.target.value })} /></div>
              <div><Label>Total weight (kg)</Label><Input type="number" step="0.01" value={form.total_weight_kg} onChange={(e) => setForm({ ...form, total_weight_kg: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Fuel</Label><Input type="number" step="0.01" value={form.fuel_expense} onChange={(e) => setForm({ ...form, fuel_expense: e.target.value })} /></div>
              <div><Label>Labour</Label><Input type="number" step="0.01" value={form.labour_expense} onChange={(e) => setForm({ ...form, labour_expense: e.target.value })} /></div>
              <div><Label>Other</Label><Input type="number" step="0.01" value={form.other_expense} onChange={(e) => setForm({ ...form, other_expense: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!printRow} onOpenChange={(o) => !o && setPrintRow(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle className="no-print">Loading Slip</DialogTitle></DialogHeader>
          {printRow && (
            <>
              <div className="print-area p-6 border rounded-md">
                <div className="text-center border-b pb-3 mb-3">
                  <div className="text-xl font-bold">TRUCK LOADING SLIP</div>
                  <div className="text-xs text-muted-foreground">MeatFlow</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><b>Date:</b> {printRow.loading_date}</div>
                  <div><b>Time:</b> {printRow.loading_time || "—"}</div>
                  <div><b>Truck:</b> {printRow.trucks?.number || "—"}</div>
                  <div><b>Driver:</b> {printRow.trucks?.driver_name || "—"}</div>
                  <div><b>Farm:</b> {printRow.farms?.name || "—"}</div>
                  <div><b>Destination:</b> {printRow.destination || "—"}</div>
                  <div><b>Chickens:</b> {printRow.chickens_count}</div>
                  <div><b>Total weight:</b> {fmtKg(printRow.total_weight_kg)}</div>
                </div>
                <div className="mt-4 border-t pt-2 text-sm">
                  <div className="flex justify-between"><span>Fuel</span><span>{fmtMoney(printRow.fuel_expense)}</span></div>
                  <div className="flex justify-between"><span>Labour</span><span>{fmtMoney(printRow.labour_expense)}</span></div>
                  <div className="flex justify-between"><span>Other</span><span>{fmtMoney(printRow.other_expense)}</span></div>
                  <div className="flex justify-between font-bold border-t mt-1 pt-1"><span>Total expenses</span><span>{fmtMoney(Number(printRow.fuel_expense) + Number(printRow.labour_expense) + Number(printRow.other_expense))}</span></div>
                </div>
                <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
                  <div>Driver signature: ____________________</div>
                  <div>Receiver signature: ____________________</div>
                </div>
              </div>
              <DialogFooter className="no-print"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete delivery?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default Deliveries;