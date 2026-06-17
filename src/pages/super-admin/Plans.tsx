import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

interface Plan { id: string; name: string; billing_cycle: string; price: number; duration_days: number; features: any; is_active: boolean }

const empty = { name: "", billing_cycle: "monthly", price: 0, duration_days: 30, features: "", is_active: true };

const Plans = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<any>(empty);

  const load = async () => {
    const { data } = await supabase.from("subscription_plans").select("*").order("price");
    setPlans(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p: Plan) => { setEditing(p); setForm({ ...p, features: Array.isArray(p.features) ? p.features.join(", ") : "" }); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name, billing_cycle: form.billing_cycle, price: Number(form.price),
      duration_days: Number(form.duration_days), is_active: form.is_active,
      features: String(form.features).split(",").map((s: string) => s.trim()).filter(Boolean),
    };
    const { error } = editing
      ? await supabase.from("subscription_plans").update(payload).eq("id", editing.id)
      : await supabase.from("subscription_plans").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved"); setOpen(false); load();
  };
  const remove = async (p: Plan) => {
    if (!confirm(`Delete plan ${p.name}?`)) return;
    const { error } = await supabase.from("subscription_plans").delete().eq("id", p.id);
    if (error) return toast.error(error.message); load();
  };
  const toggle = async (p: Plan) => {
    await supabase.from("subscription_plans").update({ is_active: !p.is_active }).eq("id", p.id);
    load();
  };

  return (
    <div className="space-y-4 text-zinc-100">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Plans</h1><p className="text-zinc-400 text-sm">Subscription plan catalog</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4"/> New Plan</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Plan" : "Create Plan"}</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Cycle</Label>
                  <Select value={form.billing_cycle} onValueChange={(v) => setForm({ ...form, billing_cycle: v })}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent><SelectItem value="trial">Trial</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Price</Label><Input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/></div>
                <div><Label>Duration (days)</Label><Input type="number" value={form.duration_days} onChange={e => setForm({ ...form, duration_days: e.target.value })}/></div>
              </div>
              <div><Label>Features (comma-separated)</Label><Input value={form.features} onChange={e => setForm({ ...form, features: e.target.value })}/></div>
              <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })}/><Label>Active</Label></div>
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="bg-zinc-900 border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm text-zinc-100">
          <thead className="bg-zinc-800/50 text-zinc-100 text-left">
            <tr><th className="p-3">Name</th><th className="p-3">Cycle</th><th className="p-3">Price</th><th className="p-3">Days</th><th className="p-3">Active</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} className="border-t border-zinc-800">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3">{p.billing_cycle}</td>
                <td className="p-3">${Number(p.price).toFixed(2)}</td>
                <td className="p-3">{p.duration_days}</td>
                <td className="p-3"><Switch checked={p.is_active} onCheckedChange={() => toggle(p)}/></td>
                <td className="p-3 text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4"/></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="h-4 w-4 text-red-400"/></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export default Plans;