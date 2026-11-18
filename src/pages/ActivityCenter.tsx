import { toast } from "sonner";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, FileDown, ShieldAlert, Search, Save, Trash2 } from "lucide-react";
import {
  type ActivityLogRow, parseUserAgent, summarizeAction,
  downloadActivityCSV, downloadActivityXLSX, downloadActivityPDF,
} from "@/lib/activityLogExport";

type Preset = {
  name: string;
  q: string; module: string; result: string; from: string; to: string; actor: string;
};
const PRESET_KEY = "activity_center_presets_v1";
const PAGE_SIZE = 50;

const MODULE_OPTIONS = [
  "all","authentication","tenant_users","user_permission_overrides","role_permissions",
  "role_templates","permission_audit_log","purchases","supplies","shop_recoveries",
  "expenses","trucks","deliveries","stock_adjustments","stock_closings","pos_sales",
  "farms","shops","customers","farm_payments","payments","customer_payments",
  "supplier_ledger_entries","shop_ledger_entries","backup_history",
];

export default function ActivityCenter() {
  const { isOwner } = usePermissions();
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Filters
  const [q, setQ] = useState("");
  const [module, setModule] = useState("all");
  const [result, setResult] = useState<"all"|"success"|"failure">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actor, setActor] = useState("");

  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? "[]"); } catch { return []; }
  });
  const [presetName, setPresetName] = useState("");

  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    const applyFilters = (qb: any) => {
      if (module !== "all") {
        // Module filter: match either entity=module or action prefix
        if (module === "authentication") qb = qb.like("action", "auth_%");
        else qb = qb.or(`entity.eq.${module},action.like.${module}\\_%`);
      }
      if (from) qb = qb.gte("created_at", new Date(from).toISOString());
      if (to) qb = qb.lte("created_at", new Date(to + "T23:59:59").toISOString());
      if (actor) qb = qb.eq("actor_user_id", actor);
      if (q) qb = qb.or(`action.ilike.%${q}%,entity.ilike.%${q}%,entity_id.ilike.%${q}%`);
      return qb;
    };
    // Rows load without an exact count (the count is slow on large logs);
    // the total is fetched separately and fills in when ready.
    const query = applyFilters(supabase
      .from("activity_logs")
      .select("id, created_at, action, entity, entity_id, tenant_id, actor_user_id, metadata")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1));
    setTotal(null);
    applyFilters(supabase.from("activity_logs").select("id", { count: "exact", head: true }))
      .then(async ({ count, error }: any) => {
        if (!error && typeof count === "number") { setTotal(count); return; }
        // Exact count can time out on very large logs — fall back to an estimate.
        const r: any = await applyFilters(supabase.from("activity_logs").select("id", { count: "estimated", head: true }));
        if (typeof r?.count === "number") setTotal(r.count);
      }, () => {});

    const { data, error } = await query;
    if (error) { setLoading(false); toast.error("Could not load activity: " + error.message); return; }
    let list = (data ?? []) as ActivityLogRow[];
    if (result !== "all") {
      list = list.filter((r) => {
        const s = r.metadata?.success;
        return result === "failure" ? s === false : s !== false;
      });
    }
    // Resolve actor names via profiles.full_name
    const ids = Array.from(new Set(list.map((r) => r.actor_user_id).filter(Boolean))) as string[];
    const missing = ids.filter((id) => !nameMap[id]);
    if (missing.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", missing);
      const next = { ...nameMap };
      (profs ?? []).forEach((p: any) => { next[p.id] = p.full_name ?? ""; });
      setNameMap(next);
    }
    setRows(list.map((r) => ({ ...r, actor_name: r.actor_user_id ? (nameMap[r.actor_user_id] ?? "") : "system" })));
    setLoading(false);
  }, [isOwner, page, module, from, to, actor, q, result, nameMap]);

  useEffect(() => { load(); }, [load]);

  const savePreset = () => {
    if (!presetName.trim()) return;
    const p: Preset = { name: presetName.trim(), q, module, result, from, to, actor };
    const next = [...presets.filter((x) => x.name !== p.name), p];
    setPresets(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    setPresetName("");
  };
  const applyPreset = (p: Preset) => {
    setQ(p.q); setModule(p.module); setResult(p.result as any);
    setFrom(p.from); setTo(p.to); setActor(p.actor); setPage(0);
  };
  const deletePreset = (name: string) => {
    const next = presets.filter((x) => x.name !== name);
    setPresets(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
  };

  const clearFilters = () => {
    setQ(""); setModule("all"); setResult("all"); setFrom(""); setTo(""); setActor(""); setPage(0);
  };

  if (!isOwner) {
    return (
      <Card className="p-8 text-center">
        <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
        <div className="font-semibold">Owner access required</div>
        <div className="text-sm text-muted-foreground">Only the account Owner can view the Activity Center.</div>
      </Card>
    );
  }

  const knownTotal = total ?? (page * PAGE_SIZE + rows.length + (rows.length === PAGE_SIZE ? 1 : 0));
  const totalPages = Math.max(1, Math.ceil(knownTotal / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Activity Center</h1>
          <p className="text-sm text-muted-foreground">Every important action across the app — append-only and tenant-isolated.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadActivityCSV(rows)}><FileDown className="h-4 w-4 mr-1"/>CSV</Button>
          <Button variant="outline" size="sm" onClick={() => downloadActivityXLSX(rows)}><FileDown className="h-4 w-4 mr-1"/>Excel</Button>
          <Button variant="outline" size="sm" onClick={() => downloadActivityPDF(rows)}><FileDown className="h-4 w-4 mr-1"/>PDF</Button>
        </div>
      </div>

      <Card className="p-4 sticky top-0 z-10 bg-card">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} placeholder="action, entity, record id" className="pl-8" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Module</Label>
            <Select value={module} onValueChange={(v) => { setPage(0); setModule(v); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODULE_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Result</Label>
            <Select value={result} onValueChange={(v) => { setPage(0); setResult(v as any); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failure">Failure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => { setPage(0); setFrom(e.target.value); }} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => { setPage(0); setTo(e.target.value); }} />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Actor User ID</Label>
            <Input value={actor} onChange={(e) => { setPage(0); setActor(e.target.value); }} placeholder="uuid (optional)" />
          </div>
          <div className="md:col-span-3 flex items-end gap-2">
            <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" />
            <Button size="sm" variant="secondary" onClick={savePreset}><Save className="h-4 w-4 mr-1"/>Save preset</Button>
            <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
          </div>
        </div>
        {presets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <div key={p.name} className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                <button onClick={() => applyPreset(p)} className="hover:underline">{p.name}</button>
                <button onClick={() => deletePreset(p.name)} aria-label={`Delete ${p.name}`}><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Browser</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No activity matches these filters.</TableCell></TableRow>}
            {rows.map((r) => {
              const { module: mod, verb } = summarizeAction(r.action);
              const ua = parseUserAgent(r.metadata?.user_agent);
              const isOpen = !!expanded[r.id];
              const success = r.metadata?.success !== false;
              return (
                <>
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}>
                    <TableCell>{isOpen ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.actor_name || <span className="text-muted-foreground">system</span>}</TableCell>
                    <TableCell className="text-xs">{mod}</TableCell>
                    <TableCell className="font-mono text-xs">{verb}</TableCell>
                    <TableCell className="text-xs">{r.entity ?? "—"}{r.entity_id && <span className="text-muted-foreground"> · {String(r.entity_id).slice(0,8)}</span>}</TableCell>
                    <TableCell>{success ? <Badge variant="secondary">success</Badge> : <Badge variant="destructive">failure</Badge>}</TableCell>
                    <TableCell className="text-xs">{r.metadata?.ip ?? ""}</TableCell>
                    <TableCell className="text-xs">{ua.browser}{ua.os && ` · ${ua.os}`}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={r.id + "-x"}>
                      <TableCell colSpan={9} className="bg-muted/40">
                        <pre className="text-xs whitespace-pre-wrap max-h-96 overflow-auto">{JSON.stringify(r.metadata, null, 2)}</pre>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{total == null ? (rows.length ? `Showing ${(page * PAGE_SIZE + 1).toLocaleString()}–${(page * PAGE_SIZE + rows.length).toLocaleString()} (counting…)` : "0 entries") : `${total.toLocaleString()} entries`} · Page {page + 1} of {totalPages}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}