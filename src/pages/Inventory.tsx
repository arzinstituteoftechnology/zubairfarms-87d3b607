import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtKg } from "@/lib/constants";
import { Boxes } from "lucide-react";

type Stock = { meat_type: string; purchased: number; supplied: number; balance: number };

const Inventory = () => {
  const [rows, setRows] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("purchases").select("meat_type, weight_kg"),
        supabase.from("supplies").select("meat_type, weight_kg"),
      ]);
      const map = new Map<string, Stock>();
      (p ?? []).forEach((r: any) => {
        const cur = map.get(r.meat_type) ?? { meat_type: r.meat_type, purchased: 0, supplied: 0, balance: 0 };
        cur.purchased += Number(r.weight_kg);
        map.set(r.meat_type, cur);
      });
      (s ?? []).forEach((r: any) => {
        const cur = map.get(r.meat_type) ?? { meat_type: r.meat_type, purchased: 0, supplied: 0, balance: 0 };
        cur.supplied += Number(r.weight_kg);
        map.set(r.meat_type, cur);
      });
      const out = [...map.values()].map((x) => ({ ...x, balance: x.purchased - x.supplied })).sort((a, b) => a.meat_type.localeCompare(b.meat_type));
      setRows(out); setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">Current stock balance per meat type (purchased − supplied)</p>
      </div>
      <Card className="p-4">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Meat type</TableHead>
              <TableHead className="text-right">Total purchased</TableHead>
              <TableHead className="text-right">Total supplied</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
                : rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground"><Boxes className="h-8 w-8 mx-auto mb-2 opacity-40" />No stock yet.</TableCell></TableRow>
                : rows.map((r) => (
                  <TableRow key={r.meat_type}>
                    <TableCell className="font-medium">{r.meat_type}</TableCell>
                    <TableCell className="text-right">{fmtKg(r.purchased)}</TableCell>
                    <TableCell className="text-right">{fmtKg(r.supplied)}</TableCell>
                    <TableCell className={`text-right font-semibold ${r.balance < 0 ? "text-destructive" : ""}`}>{fmtKg(r.balance)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};
export default Inventory;