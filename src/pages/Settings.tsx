import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer, Building2, Beef, Ruler, CreditCard, Tags, AlertTriangle, Cog, Database, LayoutDashboard, FileText, Bell, Languages, Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_PRINT_SETTINGS,
  loadPrintSettings,
  savePrintSettings,
  type PrintSettings,
} from "@/lib/printSettings";
import { usePermissions } from "@/hooks/usePermissions";
import { useSettingsLists } from "@/hooks/useSettingsLists";
import { supabase } from "@/integrations/supabase/client";

const CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR"];
const TIMEZONES = ["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Europe/London", "UTC"];

const ViewOnlyBanner = () => (
  <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
    View only — only the Owner can change these settings.
  </div>
);

const Settings = () => {
  useTranslation();
  const { isOwner } = usePermissions();
  const lists = useSettingsLists();
  const canEdit = isOwner;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Business Configuration</h1>
        <p className="text-sm text-muted-foreground">Manage company profile, master lists, and system preferences.</p>
      </div>
      {!canEdit && <ViewOnlyBanner />}
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="profile"><Building2 className="h-4 w-4 mr-1"/>Profile</TabsTrigger>
          <TabsTrigger value="meat"><Beef className="h-4 w-4 mr-1"/>Meat Types</TabsTrigger>
          <TabsTrigger value="units"><Ruler className="h-4 w-4 mr-1"/>Units</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-1"/>Payment Methods</TabsTrigger>
          <TabsTrigger value="expenses"><Tags className="h-4 w-4 mr-1"/>Expense Categories</TabsTrigger>
          <TabsTrigger value="reasons"><AlertTriangle className="h-4 w-4 mr-1"/>Adjustment Reasons</TabsTrigger>
          <TabsTrigger value="printer"><Printer className="h-4 w-4 mr-1"/>Printer</TabsTrigger>
          <TabsTrigger value="dashboard"><LayoutDashboard className="h-4 w-4 mr-1"/>Dashboard</TabsTrigger>
          <TabsTrigger value="reports"><FileText className="h-4 w-4 mr-1"/>Reports</TabsTrigger>
          <TabsTrigger value="language"><Languages className="h-4 w-4 mr-1"/>Language</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-1"/>Notifications</TabsTrigger>
          <TabsTrigger value="backup"><Database className="h-4 w-4 mr-1"/>Backup</TabsTrigger>
          <TabsTrigger value="system"><Cog className="h-4 w-4 mr-1"/>System</TabsTrigger>
        </TabsList>

        <TabsContent value="profile"><BusinessProfileSection canEdit={canEdit} lists={lists} /></TabsContent>
        <TabsContent value="meat"><MeatTypesSection canEdit={canEdit} lists={lists} /></TabsContent>
        <TabsContent value="units"><UnitsSection canEdit={canEdit} lists={lists} /></TabsContent>
        <TabsContent value="payments"><PaymentMethodsSection canEdit={canEdit} lists={lists} /></TabsContent>
        <TabsContent value="expenses"><ExpenseCategoriesSection canEdit={canEdit} lists={lists} /></TabsContent>
        <TabsContent value="reasons"><AdjustmentReasonsSection canEdit={canEdit} lists={lists} /></TabsContent>
        <TabsContent value="printer"><PrinterSection canEdit={canEdit} /></TabsContent>
        <TabsContent value="dashboard"><DashboardPrefsSection canEdit={canEdit} /></TabsContent>
        <TabsContent value="reports"><ReportsPrefsSection canEdit={canEdit} /></TabsContent>
        <TabsContent value="language"><LanguageSection /></TabsContent>
        <TabsContent value="notifications"><NotificationsSection canEdit={canEdit} /></TabsContent>
        <TabsContent value="backup"><BackupSection /></TabsContent>
        <TabsContent value="system"><SystemSection /></TabsContent>
      </Tabs>
    </div>
  );
};

const BusinessProfileSection = ({ canEdit, lists }: { canEdit: boolean; lists: ReturnType<typeof useSettingsLists> }) => {
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoDisplay, setLogoDisplay] = useState<string | null>(null);

  useEffect(() => { if (lists.businessProfile) setForm(lists.businessProfile); }, [lists.businessProfile]);

  useEffect(() => {
    (async () => {
      if (!form?.logo_url) { setLogoDisplay(null); return; }
      const { data } = await (supabase as any).storage.from("business-logos").createSignedUrl(form.logo_url, 3600);
      setLogoDisplay(data?.signedUrl ?? null);
    })();
  }, [form?.logo_url]);

  const upd = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    const payload = {
      company_name: form.company_name || null, address: form.address || null,
      phone: form.phone || null, whatsapp: form.whatsapp || null, email: form.email || null,
      ntn: form.ntn || null, strn: form.strn || null,
      currency: form.currency || "PKR", time_zone: form.time_zone || "Asia/Karachi",
      logo_url: form.logo_url || null,
    };
    const { error } = form.id
      ? await (supabase as any).from("business_profiles").update(payload).eq("id", form.id)
      : await (supabase as any).from("business_profiles").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Business profile saved");
  };

  const uploadLogo = async (file: File) => {
    if (!canEdit || !file) return;
    setUploading(true);
    const { data: bp } = await (supabase as any).from("business_profiles").select("tenant_id").maybeSingle();
    const tid = bp?.tenant_id;
    if (!tid) { setUploading(false); return toast.error("Save the profile once before uploading a logo."); }
    const ext = file.name.split(".").pop() || "png";
    const path = `${tid}/logo-${Date.now()}.${ext}`;
    const { error } = await (supabase as any).storage.from("business-logos").upload(path, file, { upsert: true });
    setUploading(false);
    if (error) return toast.error(error.message);
    setForm((f: any) => ({ ...f, logo_url: path }));
    toast.success("Logo uploaded — click Save to keep it");
  };

  return (
    <Card>
      <CardHeader><CardTitle>Business Profile</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden">
            {logoDisplay ? <img src={logoDisplay} alt="Logo" className="h-full w-full object-contain" /> : <Building2 className="h-8 w-8 text-muted-foreground" />}
          </div>
          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex gap-2 items-center">
              <Input type="file" accept="image/*" disabled={!canEdit || uploading}
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} className="max-w-xs" />
              {form.logo_url && <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => setForm((f:any)=>({...f, logo_url: null}))}>Clear</Button>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Company Name</Label><Input disabled={!canEdit} value={form.company_name ?? ""} onChange={(e) => upd("company_name", e.target.value)} /></div>
          <div><Label>Email</Label><Input disabled={!canEdit} type="email" value={form.email ?? ""} onChange={(e) => upd("email", e.target.value)} /></div>
          <div><Label>Phone</Label><Input disabled={!canEdit} value={form.phone ?? ""} onChange={(e) => upd("phone", e.target.value)} /></div>
          <div><Label>WhatsApp</Label><Input disabled={!canEdit} value={form.whatsapp ?? ""} onChange={(e) => upd("whatsapp", e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Address</Label><Textarea disabled={!canEdit} value={form.address ?? ""} onChange={(e) => upd("address", e.target.value)} /></div>
          <div><Label>NTN</Label><Input disabled={!canEdit} value={form.ntn ?? ""} onChange={(e) => upd("ntn", e.target.value)} /></div>
          <div><Label>STRN</Label><Input disabled={!canEdit} value={form.strn ?? ""} onChange={(e) => upd("strn", e.target.value)} /></div>
          <div>
            <Label>Currency</Label>
            <select className="border rounded-md h-10 px-2 w-full bg-background" disabled={!canEdit}
              value={form.currency ?? "PKR"} onChange={(e) => upd("currency", e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label>Time Zone</Label>
            <select className="border rounded-md h-10 px-2 w-full bg-background" disabled={!canEdit}
              value={form.time_zone ?? "Asia/Karachi"} onChange={(e) => upd("time_zone", e.target.value)}>
              {TIMEZONES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <Button onClick={save} disabled={!canEdit || saving}>{saving ? "Saving..." : "Save Profile"}</Button>
      </CardContent>
    </Card>
  );
};

type ListColumn = { key: string; label: string; type?: "text" | "number" | "color"; width?: string };

function GenericListEditor({
  title, table, canEdit, rows, columns, onChanged, systemFlag = "is_system", codeField,
}: {
  title: string; table: string; canEdit: boolean;
  rows: any[]; columns: ListColumn[];
  onChanged: () => Promise<void>;
  systemFlag?: string;
  codeField?: string;
}) {
  const [newRow, setNewRow] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!canEdit) return;
    const payload: any = { display_order: (rows[rows.length - 1]?.display_order ?? rows.length) + 1, is_active: true };
    for (const c of columns) payload[c.key] = newRow[c.key] ?? (c.type === "color" ? "#64748b" : "");
    if (codeField && !payload[codeField]) payload[codeField] = String(payload.name || "").toLowerCase().replace(/\s+/g, "_");
    if (!payload.name) return toast.error("Name is required");
    setBusy(true);
    const { error } = await (supabase as any).from(table).insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    setNewRow({});
    toast.success("Added");
    await onChanged();
  };

  const patch = async (id: string, patchVals: any) => {
    if (!canEdit) return;
    const { error } = await (supabase as any).from(table).update(patchVals).eq("id", id);
    if (error) return toast.error(error.message);
    await onChanged();
  };

  const del = async (row: any) => {
    if (!canEdit) return;
    if (row[systemFlag]) return toast.error("System entry — you can disable it but not delete.");
    if (!confirm(`Delete "${row.name}"?`)) return;
    const { error } = await (supabase as any).from(table).delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    await onChanged();
  };

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            {columns.map(c => <TableHead key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</TableHead>)}
            <TableHead style={{ width: 90 }}>Order</TableHead>
            <TableHead style={{ width: 90 }}>Active</TableHead>
            <TableHead style={{ width: 60 }}></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                {columns.map(c => (
                  <TableCell key={c.key}>
                    {c.type === "color" ? (
                      <input type="color" value={r[c.key] ?? "#64748b"} disabled={!canEdit}
                        onChange={(e) => patch(r.id, { [c.key]: e.target.value })}
                        className="h-8 w-16 rounded border cursor-pointer" />
                    ) : (
                      <Input defaultValue={r[c.key] ?? ""} disabled={!canEdit || (c.key === codeField && r[systemFlag])}
                        onBlur={(e) => e.target.value !== (r[c.key] ?? "") && patch(r.id, { [c.key]: e.target.value })} />
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  <Input type="number" defaultValue={r.display_order} disabled={!canEdit} className="w-20"
                    onBlur={(e) => Number(e.target.value) !== r.display_order && patch(r.id, { display_order: Number(e.target.value) })} />
                </TableCell>
                <TableCell>
                  <Switch checked={r.is_active} disabled={!canEdit} onCheckedChange={(v) => patch(r.id, { is_active: v })} />
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" disabled={!canEdit || r[systemFlag]} onClick={() => del(r)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {canEdit && (
              <TableRow className="bg-muted/20">
                {columns.map(c => (
                  <TableCell key={c.key}>
                    {c.type === "color" ? (
                      <input type="color" value={newRow[c.key] ?? "#64748b"}
                        onChange={(e) => setNewRow((n:any)=>({ ...n, [c.key]: e.target.value }))}
                        className="h-8 w-16 rounded border cursor-pointer" />
                    ) : (
                      <Input placeholder={c.label} value={newRow[c.key] ?? ""}
                        onChange={(e) => setNewRow((n:any)=>({ ...n, [c.key]: e.target.value }))} />
                    )}
                  </TableCell>
                ))}
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" disabled={busy} onClick={add}><Plus className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const MeatTypesSection = ({ canEdit, lists }: any) => (
  <GenericListEditor title="Meat Types" table="meat_types" canEdit={canEdit}
    rows={lists.meatTypes.filter((r: any) => !String(r.id).startsWith("fallback-"))}
    columns={[
      { key: "name", label: "Name" },
      { key: "color", label: "Color", type: "color", width: "100px" },
    ]}
    onChanged={lists.reload} systemFlag="__none__" />
);

const UnitsSection = ({ canEdit, lists }: any) => (
  <GenericListEditor title="Units" table="units" canEdit={canEdit} rows={lists.units}
    columns={[
      { key: "code", label: "Code", width: "120px" },
      { key: "name", label: "Name" },
    ]} onChanged={lists.reload} codeField="code" />
);

const PaymentMethodsSection = ({ canEdit, lists }: any) => (
  <GenericListEditor title="Payment Methods" table="payment_methods" canEdit={canEdit} rows={lists.paymentMethods}
    columns={[
      { key: "code", label: "Code", width: "140px" },
      { key: "name", label: "Name" },
    ]} onChanged={lists.reload} codeField="code" />
);

const ExpenseCategoriesSection = ({ canEdit, lists }: any) => (
  <GenericListEditor title="Expense Categories" table="expense_categories" canEdit={canEdit} rows={lists.expenseCategories}
    columns={[{ key: "name", label: "Name" }]} onChanged={lists.reload} systemFlag="__none__" />
);

const AdjustmentReasonsSection = ({ canEdit, lists }: any) => (
  <GenericListEditor title="Stock Adjustment Reasons" table="stock_adjustment_reasons" canEdit={canEdit} rows={lists.adjustmentReasons}
    columns={[
      { key: "code", label: "Code", width: "140px" },
      { key: "name", label: "Name" },
      { key: "description", label: "Description" },
    ]} onChanged={lists.reload} codeField="code" />
);

const PrinterSection = ({ canEdit }: { canEdit: boolean }) => {
  const [ps, setPs] = useState<PrintSettings>(() => loadPrintSettings());
  const [profile, setProfile] = useState<"a4" | "80mm" | "58mm">(() => (localStorage.getItem("printer_profile") as any) ?? "a4");
  const update = (k: keyof PrintSettings, v: number) => setPs((p) => ({ ...p, [k]: v }));
  const save = () => { savePrintSettings(ps); localStorage.setItem("printer_profile", profile); toast.success("Printer settings saved"); };
  const reset = () => { setPs({ ...DEFAULT_PRINT_SETTINGS }); savePrintSettings({ ...DEFAULT_PRINT_SETTINGS }); toast.success("Reset"); };
  const applyProfile = (p: "a4" | "80mm" | "58mm") => {
    setProfile(p);
    if (p === "a4")   setPs({ topMm: 10, pageMarginMm: 12, headerSpaceMm: 8, fontSizePx: 12, lineHeight: 1.4 });
    if (p === "80mm") setPs({ topMm: 2, pageMarginMm: 3, headerSpaceMm: 4, fontSizePx: 11, lineHeight: 1.25 });
    if (p === "58mm") setPs({ topMm: 2, pageMarginMm: 2, headerSpaceMm: 3, fontSizePx: 10, lineHeight: 1.15 });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Printer className="h-5 w-5"/>Printer Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {(["a4","80mm","58mm"] as const).map(p => (
            <Button key={p} variant={profile === p ? "default" : "outline"} size="sm" disabled={!canEdit} onClick={() => applyProfile(p)}>
              {p.toUpperCase()}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Top offset (mm)</Label><Input type="number" disabled={!canEdit} value={ps.topMm} onChange={(e) => update("topMm", Number(e.target.value))} /></div>
          <div className="space-y-2"><Label>Page margin (mm)</Label><Input type="number" disabled={!canEdit} value={ps.pageMarginMm} onChange={(e) => update("pageMarginMm", Number(e.target.value))} /></div>
          <div className="space-y-2"><Label>Header space (mm)</Label><Input type="number" disabled={!canEdit} value={ps.headerSpaceMm} onChange={(e) => update("headerSpaceMm", Number(e.target.value))} /></div>
          <div className="space-y-2"><Label>Font size (px)</Label><Input type="number" disabled={!canEdit} value={ps.fontSizePx} onChange={(e) => update("fontSizePx", Number(e.target.value))} /></div>
          <div className="space-y-2"><Label>Line height</Label><Input type="number" step="0.1" disabled={!canEdit} value={ps.lineHeight} onChange={(e) => update("lineHeight", Number(e.target.value))} /></div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={!canEdit}>Save</Button>
          <Button variant="outline" onClick={reset} disabled={!canEdit}>Reset defaults</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Test print</Button>
        </div>
      </CardContent>
    </Card>
  );
};

const DASHBOARD_KPIS = [
  "purchase", "supply", "profit", "stock",
  "payable", "receivable", "recovery",
  "mortality_today", "mortality_week", "mortality_month", "mortality_cost",
  "inventory_loss_today",
];
const DashboardPrefsSection = ({ canEdit }: { canEdit: boolean }) => {
  const key = "dashboard_visible_kpis";
  const [visible, setVisible] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? DASHBOARD_KPIS; } catch { return DASHBOARD_KPIS; }
  });
  const toggle = (k: string) => setVisible(v => v.includes(k) ? v.filter(x => x !== k) : [...v, k]);
  const save = () => { localStorage.setItem(key, JSON.stringify(visible)); toast.success("Saved"); };
  return (
    <Card>
      <CardHeader><CardTitle>Dashboard Settings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Choose which KPI cards appear on the Dashboard.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {DASHBOARD_KPIS.map(k => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Switch checked={visible.includes(k)} disabled={!canEdit} onCheckedChange={() => toggle(k)} />
              <span className="capitalize">{k.replace(/_/g, " ")}</span>
            </label>
          ))}
        </div>
        <Button onClick={save} disabled={!canEdit}>Save</Button>
      </CardContent>
    </Card>
  );
};

const ReportsPrefsSection = ({ canEdit }: { canEdit: boolean }) => {
  const key = "reports_prefs";
  const [prefs, setPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? { defaultPreset: "month", includeReversed: false, rowsPerPage: 50 }; }
    catch { return { defaultPreset: "month", includeReversed: false, rowsPerPage: 50 }; }
  });
  const save = () => { localStorage.setItem(key, JSON.stringify(prefs)); toast.success("Saved"); };
  return (
    <Card>
      <CardHeader><CardTitle>Reports Settings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Default date range</Label>
          <select className="border rounded-md h-10 px-2 w-full max-w-xs bg-background" disabled={!canEdit}
            value={prefs.defaultPreset} onChange={(e) => setPrefs((p:any)=>({...p, defaultPreset: e.target.value}))}>
            {["today","yesterday","week","month","custom"].map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2"><Switch checked={prefs.includeReversed} disabled={!canEdit} onCheckedChange={(v) => setPrefs((p:any)=>({...p, includeReversed: v}))} /><span className="text-sm">Include reversed transactions by default</span></div>
        <div><Label>Rows per page</Label><Input type="number" disabled={!canEdit} className="max-w-[120px]" value={prefs.rowsPerPage} onChange={(e) => setPrefs((p:any)=>({...p, rowsPerPage: Number(e.target.value)}))} /></div>
        <Button onClick={save} disabled={!canEdit}>Save</Button>
      </CardContent>
    </Card>
  );
};

const LanguageSection = () => (
  <Card>
    <CardHeader><CardTitle>Language</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Choose your interface language.</p>
      <LanguageSwitcher />
    </CardContent>
  </Card>
);

const NotificationsSection = ({ canEdit }: { canEdit: boolean }) => {
  const key = "notification_prefs";
  const [prefs, setPrefs] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? { lowStock: true, unpaidRecovery: true, dailyClosingDue: true, mortalitySpike: false }; }
    catch { return { lowStock: true, unpaidRecovery: true, dailyClosingDue: true, mortalitySpike: false }; }
  });
  const save = () => { localStorage.setItem(key, JSON.stringify(prefs)); toast.success("Saved"); };
  return (
    <Card>
      <CardHeader><CardTitle>Notification Settings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {Object.entries(prefs).map(([k, v]) => (
          <label key={k} className="flex items-center gap-3 text-sm">
            <Switch checked={!!v} disabled={!canEdit} onCheckedChange={(nv) => setPrefs((p:any)=>({...p, [k]: nv}))} />
            <span className="capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
          </label>
        ))}
        <Button onClick={save} disabled={!canEdit}>Save</Button>
      </CardContent>
    </Card>
  );
};

const BackupSection = () => (
  <Card>
    <CardHeader><CardTitle>Backup Settings</CardTitle></CardHeader>
    <CardContent className="text-sm text-muted-foreground">
      Automated backups are managed by the Super Admin. Contact your administrator to configure schedule and retention.
    </CardContent>
  </Card>
);

const SystemSection = () => (
  <Card>
    <CardHeader><CardTitle>System Preferences</CardTitle></CardHeader>
    <CardContent className="text-sm text-muted-foreground space-y-2">
      <div>App version: <span className="font-mono">MeatFlow 2026.07</span></div>
      <div>Data source: Lovable Cloud</div>
    </CardContent>
  </Card>
);

export default Settings;