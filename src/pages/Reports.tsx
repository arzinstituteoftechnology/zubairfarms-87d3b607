import { fetchPosSales, posProfitLines, posTotals } from "@/lib/posSales";
import { LoadingValue } from "@/components/LoadingValue";
import { mergeCollections } from "@/lib/recoveries";
import { logActivity } from "@/lib/activityLog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { computeNetProfit } from "@/lib/netProfit";
import { reconcileClosing } from "@/lib/closingVariance";
import { computeFarmBalances, totalPayableToFarms } from "@/lib/farmPayable";
import { computeShopBalances, totalReceivableFromShops } from "@/lib/shopReceivable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MEAT_TYPES, fmtKg, fmtMoney } from "@/lib/constants";
import { SeoHead } from "@/components/SeoHead";
import { printReport } from "@/lib/printReport";
import { format, startOfWeek, startOfMonth, subDays } from "date-fns";
import { FileSpreadsheet, FileText, Printer, TrendingUp, TrendingDown, DollarSign, Boxes, PackageMinus, ShoppingCart, Truck, HandCoins, Wallet, ClipboardCheck, History, Skull, LayoutDashboard, AlertTriangle, PackagePlus, Scale, Calculator, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ---------- Types ----------
type Preset = "today" | "yesterday" | "week" | "month" | "custom";
type Filters = {
  preset: Preset;
  from: string;
  to: string;
  meat_type: string;
  farm_id: string;
  shop_id: string;
  user_id: string;
  includeReversed: boolean;
  variance_type: string;   // all | balanced | shortage | surplus
  closing_status: string;  // all | draft | finalized
};

type Column = { label: string; key: string; align?: "left" | "right" | "center"; format?: "kg" | "money" | "int"; width?: string };
type Kpi = { label: string; value: string; icon?: any; tone?: string };
type ReportResult = { rows: any[]; columns: Column[]; totals: { label: string; value: string }[]; kpis: Kpi[] };

type ReportDef = {
  id: string;
  label: string;
  icon: any;
  supports: { meat?: boolean; farm?: boolean; shop?: boolean; user?: boolean };
  supportsVariance?: boolean;
  supportsStatus?: boolean;
  load: (f: Filters, opts: LookupOpts) => Promise<ReportResult>;
};

type LookupOpts = {
  farmMap: Map<string, string>;
  shopMap: Map<string, string>;
  userMap: Map<string, string>;
};

// ---------- Helpers ----------
const num = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => format(new Date(), "yyyy-MM-dd");
const applyPreset = (p: Preset, cur: Filters): Filters => {
  const now = new Date();
  switch (p) {
    case "today":     return { ...cur, preset: p, from: today(), to: today() };
    case "yesterday": { const d = format(subDays(now, 1), "yyyy-MM-dd"); return { ...cur, preset: p, from: d, to: d }; }
    case "week":      return { ...cur, preset: p, from: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: today() };
    case "month":     return { ...cur, preset: p, from: format(startOfMonth(now), "yyyy-MM-dd"), to: today() };
    case "custom":    return { ...cur, preset: p };
  }
};
const fmt = (v: any, f?: Column["format"]) => {
  if (v === null || v === undefined || v === "") return "";
  if (f === "kg") return fmtKg(v);
  if (f === "money") return fmtMoney(v);
  if (f === "int") return String(Math.round(num(v)));
  return String(v);
};

const applyReversedFilter = (q: any, includeReversed: boolean, col = "reversed_at") =>
  includeReversed ? q : q.is(col, null);

// ---------- Report loaders ----------
const REASONS_LABEL: Record<string, string> = {
  mortality: "Mortality", weight_loss: "Weight Loss", wastage: "Wastage",
  damage: "Damage", theft: "Theft", other: "Other",
};

const loaders: Record<string, ReportDef["load"]> = {
  purchases: async (f, o) => {
    let q = supabase.from("purchases")
      .select("purchase_date, meat_type, weight_kg, rate_per_kg, total_amount, paid_amount, payment_method, farm_id, created_by, reversed_at")
      .gte("purchase_date", f.from).lte("purchase_date", f.to)
      .order("purchase_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    if (f.farm_id !== "all") q = q.eq("farm_id", f.farm_id);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      farm: o.farmMap.get(r.farm_id) ?? "—",
      user: o.userMap.get(r.created_by) ?? "—",
      balance: round2(num(r.total_amount) - num(r.paid_amount)),
      status: r.reversed_at ? "Reversed" : "Active",
    }));
    const totalWeight = rows.reduce((a, r) => a + num(r.weight_kg), 0);
    const totalAmount = rows.reduce((a, r) => a + num(r.total_amount), 0);
    const totalPaid = rows.reduce((a, r) => a + num(r.paid_amount), 0);
    const totalDue = totalAmount - totalPaid;
    return {
      rows,
      columns: [
        { label: "Date", key: "purchase_date" },
        { label: "Farm", key: "farm" },
        { label: "Meat", key: "meat_type" },
        { label: "Weight", key: "weight_kg", format: "kg", align: "right" },
        { label: "Rate", key: "rate_per_kg", format: "money", align: "right" },
        { label: "Total", key: "total_amount", format: "money", align: "right" },
        { label: "Paid", key: "paid_amount", format: "money", align: "right" },
        { label: "Balance", key: "balance", format: "money", align: "right" },
        { label: "Method", key: "payment_method" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Total Weight", value: fmtKg(totalWeight) },
        { label: "Total Amount", value: fmtMoney(totalAmount) },
        { label: "Total Paid", value: fmtMoney(totalPaid) },
        { label: "Outstanding", value: fmtMoney(totalDue) },
      ],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: ShoppingCart, tone: "bg-blue-500" },
        { label: "Total Weight", value: fmtKg(totalWeight), icon: Boxes, tone: "bg-emerald-500" },
        { label: "Total Amount", value: fmtMoney(totalAmount), icon: DollarSign, tone: "bg-purple-500" },
        { label: "Outstanding", value: fmtMoney(totalDue), icon: TrendingDown, tone: "bg-red-500" },
      ],
    };
  },

  supplies: async (f, o) => {
    let q = supabase.from("supplies")
      .select("supply_date, meat_type, weight_kg, rate_per_kg, cost_per_kg, total_amount, shop_id, created_by, reversed_at")
      .gte("supply_date", f.from).lte("supply_date", f.to)
      .order("supply_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    if (f.shop_id !== "all") q = q.eq("shop_id", f.shop_id);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      shop: o.shopMap.get(r.shop_id) ?? "—",
      user: o.userMap.get(r.created_by) ?? "—",
      profit: round2((num(r.rate_per_kg) - num(r.cost_per_kg)) * num(r.weight_kg)),
      status: r.reversed_at ? "Reversed" : "Active",
    }));
    const tW = rows.reduce((a, r) => a + num(r.weight_kg), 0);
    const tA = rows.reduce((a, r) => a + num(r.total_amount), 0);
    const tP = rows.reduce((a, r) => a + num(r.profit), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "supply_date" },
        { label: "Shop", key: "shop" },
        { label: "Meat", key: "meat_type" },
        { label: "Weight", key: "weight_kg", format: "kg", align: "right" },
        { label: "Rate", key: "rate_per_kg", format: "money", align: "right" },
        { label: "Cost", key: "cost_per_kg", format: "money", align: "right" },
        { label: "Total", key: "total_amount", format: "money", align: "right" },
        { label: "Profit", key: "profit", format: "money", align: "right" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Total Weight", value: fmtKg(tW) },
        { label: "Total Sales", value: fmtMoney(tA) },
        { label: "Est. Profit", value: fmtMoney(tP) },
      ],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: Truck, tone: "bg-blue-500" },
        { label: "Total Weight", value: fmtKg(tW), icon: Boxes, tone: "bg-emerald-500" },
        { label: "Total Sales", value: fmtMoney(tA), icon: DollarSign, tone: "bg-purple-500" },
        { label: "Est. Profit", value: fmtMoney(tP), icon: TrendingUp, tone: "bg-teal-500" },
      ],
    };
  },

  recoveries: async (f, o) => {
    let q = supabase.from("shop_recoveries")
      .select("recovery_date, amount, payment_method, collected_by, notes, shop_id, created_by, reversed_at")
      .gte("recovery_date", f.from).lte("recovery_date", f.to)
      .order("recovery_date", { ascending: false });
    if (f.shop_id !== "all") q = q.eq("shop_id", f.shop_id);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    q = applyReversedFilter(q, f.includeReversed);
    let lq = (supabase as any).from("shop_ledger_entries")
      .select("id, shop_id, entry_date, entry_type, amount, description, created_by, created_at, reversed_at, original_entry_id")
      .eq("entry_type", "manual_payment").gte("entry_date", f.from).lte("entry_date", f.to);
    if (f.shop_id !== "all") lq = lq.eq("shop_id", f.shop_id);
    if (f.user_id !== "all") lq = lq.eq("created_by", f.user_id);
    if (!f.includeReversed) lq = lq.is("reversed_at", null);
    const [{ data }, { data: lp }] = await Promise.all([q, lq]);
    const ledgerRows = mergeCollections([], lp ?? []).map((r) => ({
      recovery_date: r.date, amount: r.amount, payment_method: "Shop Ledger payment", collected_by: "—",
      notes: r.notes, shop_id: r.shop_id, created_by: r.created_by, reversed_at: r.reversed_at,
    }));
    const rows = [...(data ?? []), ...ledgerRows].map((r: any) => ({
      ...r, shop: o.shopMap.get(r.shop_id) ?? "—",
      user: o.userMap.get(r.created_by) ?? "—",
      status: r.reversed_at ? "Reversed" : "Active",
    })).sort((a: any, b: any) => String(b.recovery_date).localeCompare(String(a.recovery_date)));
    const total = rows.filter((r: any) => !r.reversed_at).reduce((a, r) => a + num(r.amount), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "recovery_date" },
        { label: "Shop", key: "shop" },
        { label: "Amount", key: "amount", format: "money", align: "right" },
        { label: "Method", key: "payment_method" },
        { label: "Collector", key: "collected_by" },
        { label: "User", key: "user" },
        { label: "Notes", key: "notes" },
        { label: "Status", key: "status" },
      ],
      totals: [{ label: "Total Recovered", value: fmtMoney(total) }],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: HandCoins, tone: "bg-blue-500" },
        { label: "Total Recovered", value: fmtMoney(total), icon: DollarSign, tone: "bg-emerald-500" },
      ],
    };
  },

  shop_ledger: async (f, o) => {
    let q = supabase.from("shop_ledger_entries")
      .select("entry_date, entry_type, description, amount, shop_id, reversed_at")
      .gte("entry_date", f.from).lte("entry_date", f.to)
      .order("entry_date", { ascending: false });
    if (f.shop_id !== "all") q = q.eq("shop_id", f.shop_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => {
      const isCredit = r.entry_type === "recovery" || r.entry_type === "opening_balance" || String(r.entry_type).startsWith("reversed_supply");
      const debit = !isCredit && !String(r.entry_type).startsWith("reversed_") ? num(r.amount) : (String(r.entry_type) === "reversed_recovery" ? num(r.amount) : 0);
      const credit = isCredit ? num(r.amount) : 0;
      return { ...r, shop: o.shopMap.get(r.shop_id) ?? "—", debit, credit,
               status: r.reversed_at ? "Reversed" : "Active" };
    });
    const tD = rows.reduce((a, r) => a + num(r.debit), 0);
    const tC = rows.reduce((a, r) => a + num(r.credit), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "entry_date" },
        { label: "Shop", key: "shop" },
        { label: "Type", key: "entry_type" },
        { label: "Description", key: "description" },
        { label: "Debit", key: "debit", format: "money", align: "right" },
        { label: "Credit", key: "credit", format: "money", align: "right" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Total Debit", value: fmtMoney(tD) },
        { label: "Total Credit", value: fmtMoney(tC) },
        { label: "Net Balance", value: fmtMoney(tD - tC) },
      ],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: Wallet, tone: "bg-blue-500" },
        { label: "Total Debit", value: fmtMoney(tD), icon: TrendingUp, tone: "bg-orange-500" },
        { label: "Total Credit", value: fmtMoney(tC), icon: TrendingDown, tone: "bg-emerald-500" },
        { label: "Net Balance", value: fmtMoney(tD - tC), icon: DollarSign, tone: "bg-purple-500" },
      ],
    };
  },

  supplier_ledger: async (f, o) => {
    let q = supabase.from("supplier_ledger_entries")
      .select("entry_date, entry_type, description, amount, supplier_id, reversed_at")
      .gte("entry_date", f.from).lte("entry_date", f.to)
      .order("entry_date", { ascending: false });
    if (f.farm_id !== "all") q = q.eq("supplier_id", f.farm_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => {
      const isCredit = r.entry_type === "purchase" || r.entry_type === "opening_balance";
      const credit = isCredit ? num(r.amount) : 0;
      const debit = !isCredit ? num(r.amount) : 0;
      return { ...r, supplier: o.farmMap.get(r.supplier_id) ?? "—", debit, credit,
               status: r.reversed_at ? "Reversed" : "Active" };
    });
    const tD = rows.reduce((a, r) => a + num(r.debit), 0);
    const tC = rows.reduce((a, r) => a + num(r.credit), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "entry_date" },
        { label: "Supplier", key: "supplier" },
        { label: "Type", key: "entry_type" },
        { label: "Description", key: "description" },
        { label: "Debit", key: "debit", format: "money", align: "right" },
        { label: "Credit", key: "credit", format: "money", align: "right" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Total Debit", value: fmtMoney(tD) },
        { label: "Total Credit", value: fmtMoney(tC) },
        { label: "Net Balance", value: fmtMoney(tC - tD) },
      ],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: Wallet, tone: "bg-blue-500" },
        { label: "Total Debit", value: fmtMoney(tD), icon: TrendingDown, tone: "bg-orange-500" },
        { label: "Total Credit", value: fmtMoney(tC), icon: TrendingUp, tone: "bg-emerald-500" },
        { label: "Net Balance", value: fmtMoney(tC - tD), icon: DollarSign, tone: "bg-purple-500" },
      ],
    };
  },

  expenses: async (f, o) => {
    let q = supabase.from("expenses")
      .select("expense_date, category, amount, notes, farm_id, created_by")
      .gte("expense_date", f.from).lte("expense_date", f.to)
      .order("expense_date", { ascending: false });
    if (f.farm_id !== "all") q = q.eq("farm_id", f.farm_id);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r, farm: r.farm_id ? o.farmMap.get(r.farm_id) ?? "—" : "—",
      user: o.userMap.get(r.created_by) ?? "—",
    }));
    const total = rows.reduce((a, r) => a + num(r.amount), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "expense_date" },
        { label: "Category", key: "category" },
        { label: "Farm", key: "farm" },
        { label: "Amount", key: "amount", format: "money", align: "right" },
        { label: "User", key: "user" },
        { label: "Notes", key: "notes" },
      ],
      totals: [{ label: "Total Expenses", value: fmtMoney(total) }],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: Wallet, tone: "bg-blue-500" },
        { label: "Total", value: fmtMoney(total), icon: DollarSign, tone: "bg-red-500" },
      ],
    };
  },

  inventory: async (f, _o) => {
    // "Current stock as of f.to" — same math as Inventory page but over a range not per-day
    const asOf = f.to;
    const [{ data: prior }, { data: p }, { data: s }, { data: adj }] = await Promise.all([
      supabase.from("stock_closings").select("meat_type, physical_stock, closing_date")
        .lte("closing_date", asOf).eq("status", "finalized" as any).is("reversed_at", null)
        .order("closing_date", { ascending: false }),
      supabase.from("purchases").select("meat_type, weight_kg, purchase_date").lte("purchase_date", asOf).is("reversed_at", null),
      supabase.from("supplies").select("meat_type, weight_kg, supply_date").lte("supply_date", asOf).is("reversed_at", null),
      supabase.from("stock_adjustments").select("meat_type, quantity_kg, adjustment_date")
        .lte("adjustment_date", asOf).is("reversed_at", null).is("original_adjustment_id", null),
    ]);
    const latestClose = new Map<string, { date: string; kg: number }>();
    (prior ?? []).forEach((r: any) => {
      if (!latestClose.has(r.meat_type)) latestClose.set(r.meat_type, { date: r.closing_date, kg: num(r.physical_stock) });
    });
    const sumFrom = (arr: any[] | null, dateKey: string, valKey: string, gt?: string) => {
      const m = new Map<string, number>();
      (arr ?? []).forEach((r: any) => {
        if (gt && r[dateKey] <= gt) return;
        m.set(r.meat_type, num(m.get(r.meat_type)) + num(r[valKey]));
      });
      return m;
    };
    const types = new Set<string>(MEAT_TYPES as readonly string[]);
    (p ?? []).forEach((r: any) => types.add(r.meat_type));
    (s ?? []).forEach((r: any) => types.add(r.meat_type));
    (adj ?? []).forEach((r: any) => types.add(r.meat_type));
    latestClose.forEach((_, k) => types.add(k));

    const rows: any[] = [];
    types.forEach((mt) => {
      if (f.meat_type !== "all" && mt !== f.meat_type) return;
      const close = latestClose.get(mt);
      const gt = close?.date;
      const pMap = sumFrom(p ?? null, "purchase_date", "weight_kg", gt);
      const sMap = sumFrom(s ?? null, "supply_date", "weight_kg", gt);
      const aMap = sumFrom(adj ?? null, "adjustment_date", "quantity_kg", gt);
      const opening = round2(close?.kg ?? 0);
      const purchased = round2(pMap.get(mt) ?? 0);
      const supplied = round2(sMap.get(mt) ?? 0);
      const netAdj = round2(aMap.get(mt) ?? 0);
      const loss = round2(Math.max(0, -netAdj));
      const current = round2(opening + purchased - supplied + netAdj);
      if (opening || purchased || supplied || loss || current) {
        rows.push({ meat_type: mt, opening, purchased, supplied, loss, current });
      }
    });
    rows.sort((a, b) => a.meat_type.localeCompare(b.meat_type));
    const tCur = rows.reduce((a, r) => a + num(r.current), 0);
    const tLoss = rows.reduce((a, r) => a + num(r.loss), 0);
    return {
      rows,
      columns: [
        { label: "Meat Type", key: "meat_type" },
        { label: "Opening", key: "opening", format: "kg", align: "right" },
        { label: "Purchased", key: "purchased", format: "kg", align: "right" },
        { label: "Supplied", key: "supplied", format: "kg", align: "right" },
        { label: "Inventory Loss", key: "loss", format: "kg", align: "right" },
        { label: "Current Stock", key: "current", format: "kg", align: "right" },
      ],
      totals: [
        { label: "Total Current Stock", value: fmtKg(tCur) },
        { label: "Total Loss", value: fmtKg(tLoss) },
      ],
      kpis: [
        { label: "Meat Types", value: String(rows.length), icon: Boxes, tone: "bg-blue-500" },
        { label: "Current Stock", value: fmtKg(tCur), icon: Boxes, tone: "bg-emerald-500" },
        { label: "Total Loss", value: fmtKg(tLoss), icon: PackageMinus, tone: "bg-red-500" },
      ],
    };
  },

  daily_closing: async (f, o) => {
    let q = supabase.from("stock_closings")
      .select("closing_date, meat_type, opening_stock, purchases_kg, supplies_kg, positive_adjustments_kg, negative_adjustments_kg, mortality_weight, expected_closing_stock, physical_stock, variance_weight, variance_type, shortage_cost, status, reason, notes, created_by, finalized_by, finalized_at, reversed_by, reversed_at")
      .gte("closing_date", f.from).lte("closing_date", f.to)
      .order("closing_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    if (f.variance_type !== "all") q = q.eq("variance_type", f.variance_type as any);
    if (f.closing_status !== "all") q = q.eq("status", f.closing_status as any);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    // Rolling 30-day WAR per closing (for surplus estimated value)
    const rows = await Promise.all((data ?? []).map(async (r: any) => {
      let war = 0;
      const { data: warRes } = await supabase.rpc("compute_closing_war" as any, {
        p_meat_type: r.meat_type, p_ref_date: r.closing_date,
      }).maybeSingle();
      war = num(warRes ?? 0);
      return {
        ...r,
        surplus_estimated_value: r.variance_type === "surplus"
          ? round2(num(r.variance_weight) * war) : 0,
        reason_label: r.reason ? (REASONS_LABEL[r.reason] ?? r.reason) : "—",
        created_by_name: r.created_by ? o.userMap.get(r.created_by) ?? "—" : "—",
        finalized_by_name: r.finalized_by ? o.userMap.get(r.finalized_by) ?? "—" : "—",
        reversed_by_name: r.reversed_by ? o.userMap.get(r.reversed_by) ?? "—" : "—",
      };
    }));
    const totalVar = rows.filter(r => !r.reversed_at).reduce((a, r) => a + num(r.variance_weight), 0);
    const totalShort = rows.filter(r => r.variance_type === "shortage" && r.status === "finalized" && !r.reversed_at)
      .reduce((a, r) => a + num(r.shortage_cost), 0);
    const totalSurp = rows.filter(r => r.variance_type === "surplus" && r.status === "finalized" && !r.reversed_at)
      .reduce((a, r) => a + num(r.surplus_estimated_value), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "closing_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Opening", key: "opening_stock", format: "kg", align: "right" },
        { label: "Purchased", key: "purchases_kg", format: "kg", align: "right" },
        { label: "Supplied", key: "supplies_kg", format: "kg", align: "right" },
        { label: "Pos Adj", key: "positive_adjustments_kg", format: "kg", align: "right" },
        { label: "Neg Adj", key: "negative_adjustments_kg", format: "kg", align: "right" },
        { label: "Mortality", key: "mortality_weight", format: "kg", align: "right" },
        { label: "Expected", key: "expected_closing_stock", format: "kg", align: "right" },
        { label: "Physical", key: "physical_stock", format: "kg", align: "right" },
        { label: "Variance", key: "variance_weight", format: "kg", align: "right" },
        { label: "Type", key: "variance_type" },
        { label: "Reason", key: "reason_label" },
        { label: "Shortage Cost", key: "shortage_cost", format: "money", align: "right" },
        { label: "Surplus Value", key: "surplus_estimated_value", format: "money", align: "right" },
        { label: "Status", key: "status" },
        { label: "Created By", key: "created_by_name" },
        { label: "Finalized By", key: "finalized_by_name" },
        { label: "Finalized At", key: "finalized_at" },
        { label: "Reversed By", key: "reversed_by_name" },
        { label: "Reversed At", key: "reversed_at" },
      ],
      totals: [
        { label: "Entries", value: String(rows.length) },
        { label: "Net Variance", value: fmtKg(totalVar) },
        { label: "Finalized Shortage Cost", value: fmtMoney(totalShort) },
        { label: "Finalized Surplus Value", value: fmtMoney(totalSurp) },
      ],
      kpis: [
        { label: "Closings", value: String(rows.length), icon: ClipboardCheck, tone: "bg-blue-500" },
        { label: "Net Variance", value: fmtKg(totalVar), icon: PackageMinus, tone: "bg-orange-500" },
        { label: "Shortage Cost", value: fmtMoney(totalShort), icon: TrendingDown, tone: "bg-red-500" },
        { label: "Surplus Value", value: fmtMoney(totalSurp), icon: TrendingUp, tone: "bg-emerald-500" },
      ],
    };
  },

  closing_history: async (f) => {
    // Same source, ordered ascending for history view
    let q = supabase.from("stock_closings")
      .select("closing_date, meat_type, opening_stock, purchases_kg, supplies_kg, system_stock, physical_stock, difference, reason, notes, created_at, status, reversed_at")
      .gte("closing_date", f.from).lte("closing_date", f.to)
      .order("closing_date", { ascending: true });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r, reason_label: r.reason ? (REASONS_LABEL[r.reason] ?? r.reason) : "—",
      status_label: r.reversed_at ? "Reversed" : r.status,
    }));
    return {
      rows,
      columns: [
        { label: "Date", key: "closing_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Opening", key: "opening_stock", format: "kg", align: "right" },
        { label: "System", key: "system_stock", format: "kg", align: "right" },
        { label: "Physical", key: "physical_stock", format: "kg", align: "right" },
        { label: "Difference", key: "difference", format: "kg", align: "right" },
        { label: "Reason", key: "reason_label" },
        { label: "Notes", key: "notes" },
        { label: "Status", key: "status_label" },
      ],
      totals: [
        { label: "Active Records", value: String(rows.filter((r: any) => !r.reversed_at).length) },
        { label: "Net Difference", value: fmtKg(rows.filter((r: any) => !r.reversed_at).reduce((a: number, r: any) => a + num(r.difference), 0)) },
      ],
      kpis: [
        { label: "History Records", value: String(rows.length), icon: History, tone: "bg-blue-500" },
      ],
    };
  },

  mortality: async (f, o) => {
    let q = supabase.from("stock_adjustments")
      .select("adjustment_date, meat_type, quantity_kg, bird_count, farm_id, shop_id, notes, reversed_at, created_by")
      .eq("reason", "mortality").lt("quantity_kg", 0)
      .is("original_adjustment_id", null)
      .gte("adjustment_date", f.from).lte("adjustment_date", f.to)
      .order("adjustment_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    if (f.farm_id !== "all") q = q.eq("farm_id", f.farm_id);
    if (f.shop_id !== "all") q = q.eq("shop_id", f.shop_id);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      dead_kg: round2(Math.abs(num(r.quantity_kg))),
      farm: r.farm_id ? o.farmMap.get(r.farm_id) ?? "—" : "—",
      shop: r.shop_id ? o.shopMap.get(r.shop_id) ?? "—" : "—",
      user: o.userMap.get(r.created_by) ?? "—",
      status: r.reversed_at ? "Reversed" : "Active",
    }));
    const tKg = rows.reduce((a, r) => a + num(r.dead_kg), 0);
    const tBirds = rows.reduce((a, r) => a + num(r.bird_count), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "adjustment_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Farm", key: "farm" },
        { label: "Shop", key: "shop" },
        { label: "Dead Weight", key: "dead_kg", format: "kg", align: "right" },
        { label: "Birds", key: "bird_count", format: "int", align: "right" },
        { label: "Notes", key: "notes" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Total Dead Weight", value: fmtKg(tKg) },
        { label: "Total Birds", value: String(tBirds) },
        { label: "Entries", value: String(rows.length) },
      ],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: Skull, tone: "bg-red-500" },
        { label: "Dead Weight", value: fmtKg(tKg), icon: PackageMinus, tone: "bg-orange-500" },
        { label: "Birds", value: String(tBirds), icon: Boxes, tone: "bg-amber-500" },
      ],
    };
  },

  inventory_loss: async (f, o) => {
    let q = supabase.from("stock_adjustments")
      .select("adjustment_date, meat_type, quantity_kg, reason, notes, farm_id, shop_id, created_by, reversed_at")
      .lt("quantity_kg", 0).or("reason.is.null,reason.neq.pos_sale")
      .is("original_adjustment_id", null)
      .gte("adjustment_date", f.from).lte("adjustment_date", f.to)
      .order("adjustment_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    if (f.farm_id !== "all") q = q.eq("farm_id", f.farm_id);
    if (f.shop_id !== "all") q = q.eq("shop_id", f.shop_id);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      loss_kg: round2(Math.abs(num(r.quantity_kg))),
      reason_label: REASONS_LABEL[r.reason] ?? r.reason,
      farm: r.farm_id ? o.farmMap.get(r.farm_id) ?? "—" : "—",
      shop: r.shop_id ? o.shopMap.get(r.shop_id) ?? "—" : "—",
      user: o.userMap.get(r.created_by) ?? "—",
      status: r.reversed_at ? "Reversed" : "Active",
    }));
    const tKg = rows.reduce((a, r) => a + num(r.loss_kg), 0);
    // by reason breakdown
    const byReason: Record<string, number> = {};
    rows.forEach((r) => { byReason[r.reason_label] = round2(num(byReason[r.reason_label]) + num(r.loss_kg)); });
    const kpis: Kpi[] = [
      { label: "Entries", value: String(rows.length), icon: PackageMinus, tone: "bg-blue-500" },
      { label: "Total Loss", value: fmtKg(tKg), icon: TrendingDown, tone: "bg-red-500" },
    ];
    Object.entries(byReason).slice(0, 4).forEach(([k, v]) =>
      kpis.push({ label: k, value: fmtKg(v), icon: PackageMinus, tone: "bg-orange-500" }));
    return {
      rows,
      columns: [
        { label: "Date", key: "adjustment_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Reason", key: "reason_label" },
        { label: "Loss", key: "loss_kg", format: "kg", align: "right" },
        { label: "Farm", key: "farm" },
        { label: "Shop", key: "shop" },
        { label: "User", key: "user" },
        { label: "Notes", key: "notes" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Total Loss", value: fmtKg(tKg) },
        { label: "Entries", value: String(rows.length) },
      ],
      kpis,
    };
  },

  dashboard: async (f) => {
    // Summary: Purchases, Supplies, Recoveries, Expenses, Inventory Loss over the range
    const [{ data: p }, { data: s }, { data: r }, { data: e }, { data: a }] = await Promise.all([
      supabase.from("purchases").select("weight_kg, total_amount, paid_amount, purchase_date")
        .gte("purchase_date", f.from).lte("purchase_date", f.to).is("reversed_at", null),
      supabase.from("supplies").select("weight_kg, total_amount, cost_per_kg, rate_per_kg, supply_date")
        .gte("supply_date", f.from).lte("supply_date", f.to).is("reversed_at", null),
      supabase.from("shop_recoveries").select("amount, recovery_date")
        .gte("recovery_date", f.from).lte("recovery_date", f.to).is("reversed_at", null),
      supabase.from("expenses").select("amount, expense_date")
        .gte("expense_date", f.from).lte("expense_date", f.to),
      supabase.from("stock_adjustments").select("quantity_kg, adjustment_date")
        .lt("quantity_kg", 0).or("reason.is.null,reason.neq.pos_sale").is("reversed_at", null).is("original_adjustment_id", null)
        .gte("adjustment_date", f.from).lte("adjustment_date", f.to),
    ]);
    const sumP = (p ?? []).reduce((acc: any, x: any) => ({
      w: acc.w + num(x.weight_kg), amt: acc.amt + num(x.total_amount), paid: acc.paid + num(x.paid_amount),
    }), { w: 0, amt: 0, paid: 0 });
    const sumS = (s ?? []).reduce((acc: any, x: any) => ({
      w: acc.w + num(x.weight_kg), amt: acc.amt + num(x.total_amount),
      profit: acc.profit + (num(x.rate_per_kg) - num(x.cost_per_kg)) * num(x.weight_kg),
    }), { w: 0, amt: 0, profit: 0 });
    const sumR = (r ?? []).reduce((a, x: any) => a + num(x.amount), 0);
    const sumE = (e ?? []).reduce((a, x: any) => a + num(x.amount), 0);
    const sumLoss = (a ?? []).reduce((acc, x: any) => acc + Math.abs(num(x.quantity_kg)), 0);
    const rows = [
      { metric: "Purchases", entries: (p ?? []).length, weight: sumP.w, amount: sumP.amt, extra: `Paid: ${fmtMoney(sumP.paid)} • Due: ${fmtMoney(sumP.amt - sumP.paid)}` },
      { metric: "Supplies", entries: (s ?? []).length, weight: sumS.w, amount: sumS.amt, extra: `Est. Profit: ${fmtMoney(sumS.profit)}` },
      { metric: "Recoveries", entries: (r ?? []).length, weight: 0, amount: sumR, extra: "" },
      { metric: "Expenses", entries: (e ?? []).length, weight: 0, amount: sumE, extra: "" },
      { metric: "Inventory Loss", entries: (a ?? []).length, weight: sumLoss, amount: 0, extra: "Non-reversed only" },
    ];
    return {
      rows,
      columns: [
        { label: "Metric", key: "metric" },
        { label: "Entries", key: "entries", align: "right" },
        { label: "Weight", key: "weight", format: "kg", align: "right" },
        { label: "Amount", key: "amount", format: "money", align: "right" },
        { label: "Notes", key: "extra" },
      ],
      totals: [
        { label: "Purchases", value: fmtMoney(sumP.amt) },
        { label: "Sales", value: fmtMoney(sumS.amt) },
        { label: "Recoveries", value: fmtMoney(sumR) },
        { label: "Expenses", value: fmtMoney(sumE) },
        { label: "Net Cashflow", value: fmtMoney(sumR + sumS.amt - sumE - sumP.paid) },
      ],
      kpis: [
        { label: "Purchases", value: fmtMoney(sumP.amt), icon: ShoppingCart, tone: "bg-blue-500" },
        { label: "Sales", value: fmtMoney(sumS.amt), icon: Truck, tone: "bg-emerald-500" },
        { label: "Recoveries", value: fmtMoney(sumR), icon: HandCoins, tone: "bg-teal-500" },
        { label: "Expenses", value: fmtMoney(sumE), icon: Wallet, tone: "bg-red-500" },
        { label: "Est. Profit", value: fmtMoney(sumS.profit), icon: TrendingUp, tone: "bg-purple-500" },
        { label: "Inventory Loss", value: fmtKg(sumLoss), icon: PackageMinus, tone: "bg-orange-500" },
      ],
    };
  },

  // ---- Phase 2 additions ----

  shortage: async (f, o) => {
    let q = supabase.from("stock_closings")
      .select("closing_date, meat_type, variance_weight, shortage_cost, reason, notes, finalized_by, finalized_at")
      .eq("status", "finalized" as any).eq("variance_type", "shortage" as any).is("reversed_at", null)
      .gte("closing_date", f.from).lte("closing_date", f.to)
      .order("closing_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      shortage_kg: round2(Math.abs(num(r.variance_weight))),
      war: num(r.shortage_cost) / (Math.abs(num(r.variance_weight)) || 1),
      reason_label: r.reason ? (REASONS_LABEL[r.reason] ?? r.reason) : "—",
      finalized_by_name: r.finalized_by ? o.userMap.get(r.finalized_by) ?? "—" : "—",
    }));
    const tKg = rows.reduce((a, r) => a + num(r.shortage_kg), 0);
    const tCost = rows.reduce((a, r) => a + num(r.shortage_cost), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "closing_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Shortage (kg)", key: "shortage_kg", format: "kg", align: "right" },
        { label: "WAR", key: "war", format: "money", align: "right" },
        { label: "Shortage Cost", key: "shortage_cost", format: "money", align: "right" },
        { label: "Reason", key: "reason_label" },
        { label: "Notes", key: "notes" },
        { label: "Finalized By", key: "finalized_by_name" },
      ],
      totals: [
        { label: "Total Shortage", value: fmtKg(tKg) },
        { label: "Total Shortage Cost", value: fmtMoney(tCost) },
        { label: "Entries", value: String(rows.length) },
      ],
      kpis: [
        { label: "Shortage Events", value: String(rows.length), icon: AlertTriangle, tone: "bg-red-500" },
        { label: "Total Shortage", value: fmtKg(tKg), icon: TrendingDown, tone: "bg-orange-500" },
        { label: "Shortage Cost", value: fmtMoney(tCost), icon: DollarSign, tone: "bg-red-500" },
      ],
    };
  },

  surplus: async (f, o) => {
    let q = supabase.from("stock_closings")
      .select("closing_date, meat_type, variance_weight, reason, notes, finalized_by, finalized_at")
      .eq("status", "finalized" as any).eq("variance_type", "surplus" as any).is("reversed_at", null)
      .gte("closing_date", f.from).lte("closing_date", f.to)
      .order("closing_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    const { data } = await q;
    const rows = await Promise.all((data ?? []).map(async (r: any) => {
      const { data: warRes } = await supabase.rpc("compute_closing_war" as any, {
        p_meat_type: r.meat_type, p_ref_date: r.closing_date,
      }).maybeSingle();
      const war = num(warRes ?? 0);
      return {
        ...r,
        surplus_kg: round2(num(r.variance_weight)),
        war,
        surplus_value: round2(num(r.variance_weight) * war),
        reason_label: r.reason ? (REASONS_LABEL[r.reason] ?? r.reason) : "—",
        finalized_by_name: r.finalized_by ? o.userMap.get(r.finalized_by) ?? "—" : "—",
      };
    }));
    const tKg = rows.reduce((a, r) => a + num(r.surplus_kg), 0);
    const tVal = rows.reduce((a, r) => a + num(r.surplus_value), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "closing_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Surplus (kg)", key: "surplus_kg", format: "kg", align: "right" },
        { label: "Valuation Rate", key: "war", format: "money", align: "right" },
        { label: "Est. Value", key: "surplus_value", format: "money", align: "right" },
        { label: "Reason", key: "reason_label" },
        { label: "Notes", key: "notes" },
        { label: "Finalized By", key: "finalized_by_name" },
      ],
      totals: [
        { label: "Total Surplus", value: fmtKg(tKg) },
        { label: "Total Est. Value", value: fmtMoney(tVal) },
        { label: "Entries", value: String(rows.length) },
      ],
      kpis: [
        { label: "Surplus Events", value: String(rows.length), icon: PackagePlus, tone: "bg-emerald-500" },
        { label: "Total Surplus", value: fmtKg(tKg), icon: TrendingUp, tone: "bg-emerald-500" },
        { label: "Est. Value (info)", value: fmtMoney(tVal), icon: DollarSign, tone: "bg-teal-500" },
      ],
    };
  },

  inventory_variance: async (f) => {
    let q = supabase.from("stock_closings")
      .select("closing_date, meat_type, expected_closing_stock, physical_stock, variance_weight, variance_type, status, reversed_at")
      .gte("closing_date", f.from).lte("closing_date", f.to)
      .order("closing_date", { ascending: true });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => {
      const expected = num(r.expected_closing_stock);
      const variance = num(r.variance_weight);
      const pct = expected !== 0 ? round2((variance / expected) * 100) : 0;
      return { ...r, variance_pct: pct };
    });
    const activeRows = rows.filter((r: any) => !r.reversed_at);
    const totExp = activeRows.reduce((a, r) => a + num(r.expected_closing_stock), 0);
    const totPhys = activeRows.reduce((a, r) => a + num(r.physical_stock), 0);
    const totVar = activeRows.reduce((a, r) => a + num(r.variance_weight), 0);
    const balCount = activeRows.filter(r => r.variance_type === "balanced").length;
    const shortCount = activeRows.filter(r => r.variance_type === "shortage").length;
    const surpCount = activeRows.filter(r => r.variance_type === "surplus").length;
    return {
      rows,
      columns: [
        { label: "Date", key: "closing_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Expected", key: "expected_closing_stock", format: "kg", align: "right" },
        { label: "Physical", key: "physical_stock", format: "kg", align: "right" },
        { label: "Variance", key: "variance_weight", format: "kg", align: "right" },
        { label: "Variance %", key: "variance_pct", align: "right" },
        { label: "Type", key: "variance_type" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Expected", value: fmtKg(totExp) },
        { label: "Physical", value: fmtKg(totPhys) },
        { label: "Net Variance", value: fmtKg(totVar) },
      ],
      kpis: [
        { label: "Records", value: String(rows.length), icon: Scale, tone: "bg-blue-500" },
        { label: "Balanced", value: String(balCount), icon: ClipboardCheck, tone: "bg-slate-500" },
        { label: "Shortage", value: String(shortCount), icon: TrendingDown, tone: "bg-red-500" },
        { label: "Surplus", value: String(surpCount), icon: TrendingUp, tone: "bg-emerald-500" },
      ],
    };
  },

  stock_adj_analysis: async (f, o) => {
    let q = supabase.from("stock_adjustments")
      .select("adjustment_date, meat_type, quantity_kg, reason, notes, created_by, reversed_at")
      .is("original_adjustment_id", null).or("reason.is.null,reason.neq.pos_sale")
      .gte("adjustment_date", f.from).lte("adjustment_date", f.to)
      .order("adjustment_date", { ascending: false });
    if (f.meat_type !== "all") q = q.eq("meat_type", f.meat_type);
    if (f.user_id !== "all") q = q.eq("created_by", f.user_id);
    q = applyReversedFilter(q, f.includeReversed);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      type: num(r.quantity_kg) >= 0 ? "Positive" : "Negative",
      abs_kg: round2(Math.abs(num(r.quantity_kg))),
      reason_label: REASONS_LABEL[r.reason] ?? r.reason ?? "—",
      user: o.userMap.get(r.created_by) ?? "—",
      status: r.reversed_at ? "Reversed" : "Active",
    }));
    const pos = rows.filter(r => r.type === "Positive").reduce((a, r) => a + num(r.abs_kg), 0);
    const neg = rows.filter(r => r.type === "Negative").reduce((a, r) => a + num(r.abs_kg), 0);
    return {
      rows,
      columns: [
        { label: "Date", key: "adjustment_date" },
        { label: "Meat", key: "meat_type" },
        { label: "Type", key: "type" },
        { label: "Reason", key: "reason_label" },
        { label: "Quantity", key: "abs_kg", format: "kg", align: "right" },
        { label: "User", key: "user" },
        { label: "Notes", key: "notes" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Positive Total", value: fmtKg(pos) },
        { label: "Negative Total", value: fmtKg(neg) },
        { label: "Net", value: fmtKg(pos - neg) },
      ],
      kpis: [
        { label: "Entries", value: String(rows.length), icon: Scale, tone: "bg-blue-500" },
        { label: "Positive", value: fmtKg(pos), icon: PackagePlus, tone: "bg-emerald-500" },
        { label: "Negative", value: fmtKg(neg), icon: PackageMinus, tone: "bg-red-500" },
      ],
    };
  },

  sales: async (f, o) => {
    const all = await fetchPosSales(f.from, f.to);
    const list = f.includeReversed ? all : all.filter((s) => !s.voided_at);
    const rows = list.map((s) => ({
      sale_date: s.sale_date, invoice_no: "#" + s.invoice_no,
      items: (s.pos_sale_items ?? []).map((i) => `${i.meat_type} ${Number(i.weight_kg)}kg @ ${Number(i.final_rate)}`).join(", "),
      qty: (s.pos_sale_items ?? []).reduce((a, i) => a + num(i.weight_kg), 0),
      total: num(s.total), paid: num(s.paid), due: num(s.due),
      method: s.payment_method ?? "—", user: o.userMap.get(s.created_by ?? "") ?? "—",
      status: s.voided_at ? `Void — ${s.void_reason ?? ""}` : "Active",
    }));
    const t = posTotals(all);
    return {
      rows,
      columns: [
        { label: "Date", key: "sale_date" },
        { label: "Invoice", key: "invoice_no" },
        { label: "Items", key: "items" },
        { label: "Qty (kg)", key: "qty", format: "kg", align: "right" },
        { label: "Total", key: "total", format: "money", align: "right" },
        { label: "Paid", key: "paid", format: "money", align: "right" },
        { label: "Due", key: "due", format: "money", align: "right" },
        { label: "Method", key: "method" },
        { label: "User", key: "user" },
        { label: "Status", key: "status" },
      ],
      totals: [
        { label: "Invoices", value: String(t.count) },
        { label: "Sales", value: fmtMoney(t.total) },
        { label: "Paid", value: fmtMoney(t.paid) },
        { label: "Due", value: fmtMoney(t.due) },
      ],
      kpis: [
        { label: "Invoices", value: String(t.count), icon: ShoppingCart, tone: "bg-blue-500" },
        { label: "Sales", value: fmtMoney(t.total), icon: DollarSign, tone: "bg-emerald-500" },
        { label: "Paid", value: fmtMoney(t.paid), icon: HandCoins, tone: "bg-emerald-500" },
        { label: "Due", value: fmtMoney(t.due), icon: Wallet, tone: "bg-orange-500" },
      ],
    };
  },

  profit_recon: async (f) => {
    const [{ data: sup }, { data: exp }, { data: del }, { data: sc }] = await Promise.all([
      supabase.from("supplies").select("weight_kg, rate_per_kg, cost_per_kg, supply_date, reversed_at")
        .gte("supply_date", f.from).lte("supply_date", f.to).is("reversed_at", null),
      supabase.from("expenses").select("amount, expense_date")
        .gte("expense_date", f.from).lte("expense_date", f.to),
      supabase.from("deliveries").select("fuel_expense, labour_expense, other_expense, loading_date")
        .gte("loading_date", f.from).lte("loading_date", f.to),
      supabase.from("stock_closings").select("shortage_cost, closing_date, status, variance_type, reversed_at")
        .gte("closing_date", f.from).lte("closing_date", f.to)
        .eq("status", "finalized" as any).eq("variance_type", "shortage" as any).is("reversed_at", null),
    ]);
    const shortageCost = (sc ?? []).reduce((a, r: any) => a + num(r.shortage_cost), 0);
    const posRows = await fetchPosSales(f.from, f.to);
    const posLines = posProfitLines(posRows);
    const posGross = posLines.reduce((a, l) => a + num(l.weight_kg) * (num(l.rate_per_kg) - num(l.cost_per_kg)), 0);
    const bd = computeNetProfit({
      supplies: [...(sup ?? []), ...posLines] as any,
      expenses: exp ?? [],
      deliveries: del ?? [],
      finalizedShortageCost: shortageCost,
    });
    const rows = [
      { line: "Gross Profit",              formula: "Σ (rate − cost) × weight (supplies + POS)",  amount: bd.grossProfit },
      { line: "  of which POS sales",       formula: "Σ (final rate − cost) × kg − discount", amount: round2(posGross) },
      { line: "− General Expenses",        formula: "Σ expenses.amount",           amount: -bd.generalExpense },
      { line: "− Truck Delivery Expenses", formula: "Σ (fuel + labour + other)",   amount: -bd.deliveryExpense },
      { line: "− Finalized Shortage Cost", formula: "Σ finalized shortage.cost",   amount: -bd.finalizedShortageCost },
      { line: "= Net Profit",              formula: "Gross − Gen − Del − Shortage", amount: bd.netProfit },
    ];
    return {
      rows,
      columns: [
        { label: "Line", key: "line" },
        { label: "Formula", key: "formula" },
        { label: "Amount", key: "amount", format: "money", align: "right" },
      ],
      totals: [
        { label: "Gross Profit", value: fmtMoney(bd.grossProfit) },
        { label: "General Exp", value: fmtMoney(bd.generalExpense) },
        { label: "Delivery Exp", value: fmtMoney(bd.deliveryExpense) },
        { label: "Shortage Cost", value: fmtMoney(bd.finalizedShortageCost) },
        { label: "Net Profit", value: fmtMoney(bd.netProfit) },
      ],
      kpis: [
        { label: "Gross Profit", value: fmtMoney(bd.grossProfit), icon: TrendingUp, tone: "bg-emerald-500" },
        { label: "General Exp", value: fmtMoney(bd.generalExpense), icon: Wallet, tone: "bg-orange-500" },
        { label: "Delivery Exp", value: fmtMoney(bd.deliveryExpense), icon: Truck, tone: "bg-orange-500" },
        { label: "Shortage Cost", value: fmtMoney(bd.finalizedShortageCost), icon: TrendingDown, tone: "bg-red-500" },
        { label: "Net Profit", value: fmtMoney(bd.netProfit), icon: Calculator, tone: bd.netProfit >= 0 ? "bg-purple-500" : "bg-red-500" },
      ],
    };
  },

  payable_receivable: async (f, o) => {
    const asOf = f.to;
    const [farmsQ, shopsQ, purQ, payQ, ledSupQ, supQ, ledShopQ, recQ] = await Promise.all([
      supabase.from("farms").select("id, name, opening_balance").is("deleted_at", null),
      supabase.from("shops").select("id, name, opening_balance").is("deleted_at", null),
      supabase.from("purchases").select("farm_id, total_amount, paid_amount, purchase_date, reversed_at"),
      supabase.from("farm_payments").select("farm_id, amount, payment_date, reversed_at"),
      supabase.from("supplier_ledger_entries").select("supplier_id, entry_type, amount, entry_date, reversed_at, original_entry_id"),
      supabase.from("supplies").select("shop_id, total_amount, supply_date, reversed_at"),
      supabase.from("shop_ledger_entries").select("id, shop_id, entry_type, amount, entry_date, reversed_at, reversal_entry_id, original_entry_id"),
      supabase.from("shop_recoveries").select("ledger_entry_id, reversed_at").not("reversed_at", "is", null),
    ]);
    const farmBal = computeFarmBalances(
      (farmsQ.data ?? []) as any,
      (purQ.data ?? []) as any,
      (payQ.data ?? []) as any,
      ((ledSupQ.data ?? []) as any[]).map((x) => ({ ...x, farm_id: x.supplier_id })) as any,
      asOf,
    );
    const shopBal = computeShopBalances(
      (shopsQ.data ?? []) as any,
      (supQ.data ?? []) as any,
      (ledShopQ.data ?? []) as any,
      (recQ.data ?? []) as any,
      asOf,
    );
    const farmName = new Map((farmsQ.data ?? []).map((x: any) => [x.id, x.name]));
    const shopName = new Map((shopsQ.data ?? []).map((x: any) => [x.id, x.name]));
    const farmRows = farmBal
      .filter((b) => Math.abs(b.balance) > 0.01)
      .sort((a, b) => b.balance - a.balance)
      .map((b) => ({
        party: farmName.get(b.id) ?? "—", side: "Farm Payable",
        opening: b.opening, activity: b.purchased, payments: b.paid, adjustments: b.adj,
        balance: round2(b.balance),
      }));
    const shopRows = shopBal
      .filter((b) => Math.abs(b.balance) > 0.01)
      .sort((a, b) => b.balance - a.balance)
      .map((b) => ({
        party: shopName.get(b.id) ?? "—", side: "Shop Receivable",
        opening: b.opening, activity: b.supplied, payments: b.paid, adjustments: b.adj,
        balance: round2(b.balance),
      }));
    const totalPay = totalPayableToFarms(farmBal);
    const totalRec = totalReceivableFromShops(shopBal);
    const rows = [...farmRows, ...shopRows];
    return {
      rows,
      columns: [
        { label: "Side", key: "side" },
        { label: "Party", key: "party" },
        { label: "Opening", key: "opening", format: "money", align: "right" },
        { label: "Activity", key: "activity", format: "money", align: "right" },
        { label: "Payments/Recoveries", key: "payments", format: "money", align: "right" },
        { label: "Adjustments", key: "adjustments", format: "money", align: "right" },
        { label: "Balance", key: "balance", format: "money", align: "right" },
      ],
      totals: [
        { label: "Total Payable", value: fmtMoney(totalPay) },
        { label: "Total Receivable", value: fmtMoney(totalRec) },
        { label: "Net Working Capital", value: fmtMoney(totalRec - totalPay) },
      ],
      kpis: [
        { label: "Farm Payable", value: fmtMoney(totalPay), icon: TrendingDown, tone: "bg-red-500" },
        { label: "Shop Receivable", value: fmtMoney(totalRec), icon: TrendingUp, tone: "bg-emerald-500" },
        { label: "Net Working Capital", value: fmtMoney(totalRec - totalPay), icon: DollarSign, tone: (totalRec - totalPay) >= 0 ? "bg-purple-500" : "bg-red-500" },
        { label: "Top Farm Balance", value: farmRows[0] ? fmtMoney(farmRows[0].balance) : "—", icon: Wallet, tone: "bg-orange-500" },
        { label: "Top Shop Balance", value: shopRows[0] ? fmtMoney(shopRows[0].balance) : "—", icon: Wallet, tone: "bg-blue-500" },
      ],
    };
  },

  reversal_audit: async (f, o) => {
    let q = supabase.from("activity_logs")
      .select("created_at, action, entity, entity_id, actor_user_id, metadata")
      .ilike("action", "%revers%")
      .gte("created_at", f.from + "T00:00:00")
      .lte("created_at", f.to + "T23:59:59")
      .order("created_at", { ascending: false });
    if (f.user_id !== "all") q = q.eq("actor_user_id", f.user_id);
    const { data } = await q;
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      user: r.actor_user_id ? o.userMap.get(r.actor_user_id) ?? "—" : "System",
      reason: r.metadata?.reason ?? r.metadata?.reversal_reason ?? "—",
      amount: r.metadata?.amount ?? r.metadata?.total_amount ?? r.metadata?.weight_kg ?? "",
      audit_ref: r.entity_id ?? "",
      ts: r.created_at ? new Date(r.created_at).toLocaleString() : "",
    }));
    return {
      rows,
      columns: [
        { label: "When", key: "ts" },
        { label: "Module", key: "entity" },
        { label: "Action", key: "action" },
        { label: "Original Record", key: "audit_ref" },
        { label: "Amount/Weight", key: "amount" },
        { label: "Reason", key: "reason" },
        { label: "Reversed By", key: "user" },
      ],
      totals: [{ label: "Reversal Events", value: String(rows.length) }],
      kpis: [
        { label: "Reversal Events", value: String(rows.length), icon: RotateCcw, tone: "bg-orange-500" },
      ],
    };
  },
};

const REPORTS: ReportDef[] = [
  { id: "purchases",       label: "Purchase Report",         icon: ShoppingCart,    supports: { meat: true, farm: true, user: true },  load: loaders.purchases },
  { id: "supplies",        label: "Supply Report",           icon: Truck,           supports: { meat: true, shop: true, user: true },  load: loaders.supplies },
  { id: "sales",           label: "Sales Report (POS)",      icon: ShoppingCart,    supports: { user: true },                          load: loaders.sales },
  { id: "recoveries",      label: "Daily Recovery Report",   icon: HandCoins,       supports: { shop: true, user: true },              load: loaders.recoveries },
  { id: "shop_ledger",     label: "Shop Ledger Report",      icon: Wallet,          supports: { shop: true },                          load: loaders.shop_ledger },
  { id: "supplier_ledger", label: "Supplier Ledger Report",  icon: Wallet,          supports: { farm: true },                          load: loaders.supplier_ledger },
  { id: "expenses",        label: "Expense Report",          icon: Wallet,          supports: { farm: true, user: true },              load: loaders.expenses },
  { id: "inventory",       label: "Inventory Report",        icon: Boxes,           supports: { meat: true },                          load: loaders.inventory },
  { id: "daily_closing",   label: "Daily Closing Stock",     icon: ClipboardCheck,  supports: { meat: true }, supportsVariance: true, supportsStatus: true, load: loaders.daily_closing },
  { id: "inventory_variance", label: "Inventory Variance",   icon: Scale,           supports: { meat: true },                          load: loaders.inventory_variance },
  { id: "shortage",        label: "Shortage Report",         icon: AlertTriangle,   supports: { meat: true },                          load: loaders.shortage },
  { id: "surplus",         label: "Surplus Report",          icon: PackagePlus,     supports: { meat: true },                          load: loaders.surplus },
  { id: "stock_adj_analysis", label: "Stock Adjustment Analysis", icon: Scale,      supports: { meat: true, user: true },              load: loaders.stock_adj_analysis },
  { id: "closing_history", label: "Closing History Report",  icon: History,         supports: { meat: true },                          load: loaders.closing_history },
  { id: "mortality",       label: "Mortality Register",      icon: Skull,           supports: { meat: true, farm: true, shop: true, user: true }, load: loaders.mortality },
  { id: "inventory_loss",  label: "Inventory Loss Report",   icon: PackageMinus,    supports: { meat: true, farm: true, shop: true, user: true }, load: loaders.inventory_loss },
  { id: "profit_recon",    label: "Profit Reconciliation",   icon: Calculator,      supports: {},                                      load: loaders.profit_recon },
  { id: "payable_receivable", label: "Payable & Receivable", icon: Wallet,          supports: {},                                      load: loaders.payable_receivable },
  { id: "reversal_audit",  label: "Reversal & Audit",        icon: RotateCcw,       supports: { user: true },                          load: loaders.reversal_audit },
  { id: "dashboard",       label: "Dashboard Summary",       icon: LayoutDashboard, supports: {},                                      load: loaders.dashboard },
];

// ---------- Page ----------
const Reports = () => {
  const { tenant } = useAuth();
  const [reportId, setReportId] = useState<string>("purchases");
  const [filters, setFilters] = useState<Filters>(applyPreset("today", {
    preset: "today", from: today(), to: today(),
    meat_type: "all", farm_id: "all", shop_id: "all", user_id: "all",
    includeReversed: false, variance_type: "all", closing_status: "all",
  }));
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [company, setCompany] = useState<{ company_name?: string; address?: string; phone?: string } | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const def = REPORTS.find((r) => r.id === reportId)!;

  useEffect(() => {
    (async () => {
      const [{ data: f }, { data: s }, { data: u }] = await Promise.all([
        supabase.from("farms").select("id, name").is("deleted_at", null).order("name"),
        supabase.from("shops").select("id, name").is("deleted_at", null).order("name"),
        supabase.from("profiles").select("id, full_name").order("full_name"),
      ]);
      setFarms((f ?? []) as any);
      setShops((s ?? []) as any);
      setUsers((u ?? []) as any);
      if (tenant?.id) {
        const { data: bp } = await supabase.from("business_profiles")
          .select("company_name, address, phone").eq("tenant_id", tenant.id).maybeSingle();
        setCompany(bp as any);
      }
    })();
  }, [tenant?.id]);

  const lookups: LookupOpts = useMemo(() => ({
    farmMap: new Map(farms.map((x) => [x.id, x.name])),
    shopMap: new Map(shops.map((x) => [x.id, x.name])),
    userMap: new Map(users.map((x) => [x.id, x.full_name ?? "—"])),
  }), [farms, shops, users]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await def.load(filters, lookups);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }, [def, filters, lookups]);

  useEffect(() => { load(); }, [load]);

  // Record report views for the activity log / usage counters (once per report+range).
  useEffect(() => {
    if (!tenant?.id) return;
    const t = setTimeout(() => { logActivity("report_viewed", "reports", reportId, { report: reportId, from: filters.from, to: filters.to }, tenant.id); }, 800);
    return () => clearTimeout(t);
  }, [reportId, filters.from, filters.to, tenant?.id]);

  // Realtime: refresh on any change to relevant tables
  useEffect(() => {
    const ch = supabase.channel("reports-live" + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "supplies" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_recoveries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_ledger_entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "supplier_ledger_entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_closings" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_adjustments" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_sales" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, preset: patch.from || patch.to ? "custom" : f.preset }));

  const headerLines = () => {
    const parts: string[] = [];
    if (company?.company_name) parts.push(company.company_name);
    if (tenant?.company_name && tenant.company_name !== company?.company_name) parts.push(`Tenant: ${tenant.company_name}`);
    const filterBits: string[] = [];
    if (filters.meat_type !== "all") filterBits.push(`Meat: ${filters.meat_type}`);
    if (filters.variance_type !== "all") filterBits.push(`Variance: ${filters.variance_type}`);
    if (filters.closing_status !== "all") filterBits.push(`Status: ${filters.closing_status}`);
    if (filters.includeReversed) filterBits.push("Includes Reversed");
    return { parts, filterBits, generatedAt: new Date().toLocaleString() };
  };

  const doPrint = () => {
    if (!result) return;
    const h = headerLines();
    printReport({
      title: def.label,
      subtitle: `${filters.from} to ${filters.to}${h.filterBits.length ? " • " + h.filterBits.join(" • ") : ""}${h.parts.length ? " • " + h.parts.join(" — ") : ""} • Generated ${h.generatedAt}`,
      dateLabel: `${filters.from} — ${filters.to}`,
      columns: result.columns.map((c) => ({
        label: c.label,
        align: c.align,
        value: (r: any) => fmt(r[c.key], c.format),
      })),
      rows: result.rows,
      totals: result.totals,
      orientation: result.columns.length > 6 ? "landscape" : "portrait",
    });
  };

  const doExcel = () => {
    if (!result) return;
    const h = headerLines();
    const data = result.rows.map((r) => {
      const o: any = {};
      result.columns.forEach((c) => { o[c.label] = c.format ? fmt(r[c.key], c.format).replace(/[^\d.\-]/g, "") : (r[c.key] ?? ""); });
      return o;
    });
    const wb = XLSX.utils.book_new();
    const meta = [
      { Metric: "Report", Value: def.label },
      { Metric: "Date Range", Value: `${filters.from} to ${filters.to}` },
      ...h.parts.map((p) => ({ Metric: "Company/Tenant", Value: p })),
      ...h.filterBits.map((p) => ({ Metric: "Filter", Value: p })),
      { Metric: "Generated At", Value: h.generatedAt },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), "Header");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Report");
    if (result.totals.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.totals.map(t => ({ Metric: t.label, Value: t.value }))), "Totals");
    }
    XLSX.writeFile(wb, `${def.id}_${filters.from}_${filters.to}.xlsx`);
  };

  const doPdf = () => {
    if (!result) return;
    const h = headerLines();
    const pdf = new jsPDF({ orientation: result.columns.length > 6 ? "landscape" : "portrait" });
    pdf.setFontSize(14); pdf.text(def.label, 14, 14);
    pdf.setFontSize(9);
    let y = 20;
    if (h.parts.length) { pdf.text(h.parts.join(" — "), 14, y); y += 5; }
    pdf.text(`${filters.from} to ${filters.to}${h.filterBits.length ? " • " + h.filterBits.join(" • ") : ""}`, 14, y); y += 5;
    pdf.text(`Generated: ${h.generatedAt}`, 14, y); y += 3;
    autoTable(pdf, {
      startY: y + 3,
      head: [result.columns.map((c) => c.label)],
      body: result.rows.map((r) => result.columns.map((c) => fmt(r[c.key], c.format))),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [40, 40, 40] },
      didDrawPage: (data) => {
        const pageNum = (pdf as any).internal.getNumberOfPages();
        pdf.setFontSize(8);
        pdf.text(`Page ${pageNum}`, data.settings.margin.left, (pdf as any).internal.pageSize.height - 6);
      },
    });
    if (result.totals.length) {
      const yy = (pdf as any).lastAutoTable.finalY + 6;
      pdf.setFontSize(10);
      result.totals.forEach((t, i) => pdf.text(`${t.label}: ${t.value}`, 14, yy + i * 5));
    }
    pdf.save(`${def.id}_${filters.from}_${filters.to}.pdf`);
  };

  return (
    <div className="space-y-4">
      <SeoHead title="Reports Center" description="All printable business reports in one place." path="/reports" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports Center</h1>
        <p className="text-sm text-muted-foreground">All printable reports for your business in one place.</p>
      </div>

      {/* Report picker */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {REPORTS.map((r) => (
            <Button
              key={r.id}
              variant={reportId === r.id ? "default" : "outline"}
              size="sm"
              className="justify-start"
              onClick={() => setReportId(r.id)}
            >
              <r.icon className="h-4 w-4" />
              <span className="truncate text-xs">{r.label}</span>
            </Button>
          ))}
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4 space-y-3">
        <Tabs value={filters.preset} onValueChange={(v) => setFilters((f) => applyPreset(v as Preset, f))}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="yesterday">Yesterday</TabsTrigger>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="month">This Month</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
          </div>
          {def.supports.meat && (
            <div>
              <Label className="text-xs">Meat Type</Label>
              <Select value={filters.meat_type} onValueChange={(v) => setF({ meat_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {MEAT_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def.supports.farm && (
            <div>
              <Label className="text-xs">Farm / Supplier</Label>
              <Select value={filters.farm_id} onValueChange={(v) => setF({ farm_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {farms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def.supports.shop && (
            <div>
              <Label className="text-xs">Shop</Label>
              <Select value={filters.shop_id} onValueChange={(v) => setF({ shop_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {shops.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def.supports.user && (
            <div>
              <Label className="text-xs">User</Label>
              <Select value={filters.user_id} onValueChange={(v) => setF({ user_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name ?? "—"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def.supportsVariance && (
            <div>
              <Label className="text-xs">Variance Type</Label>
              <Select value={filters.variance_type} onValueChange={(v) => setF({ variance_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="shortage">Shortage</SelectItem>
                  <SelectItem value="surplus">Surplus</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {def.supportsStatus && (
            <div>
              <Label className="text-xs">Closing Status</Label>
              <Select value={filters.closing_status} onValueChange={(v) => setF({ closing_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="finalized">Finalized</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Switch id="incl-rev" checked={filters.includeReversed} onCheckedChange={(v) => setF({ includeReversed: v })} />
            <Label htmlFor="incl-rev" className="text-sm cursor-pointer">Include Reversed Transactions</Label>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={doPrint} disabled={!result}><Printer className="h-4 w-4" />Print</Button>
            <Button variant="outline" size="sm" onClick={doExcel} disabled={!result}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
            <Button variant="outline" size="sm" onClick={doPdf} disabled={!result}><FileText className="h-4 w-4" />PDF</Button>
          </div>
        </div>
      </Card>

      {/* KPI cards */}
      {result && result.kpis.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {result.kpis.map((k, i) => (
            <Card key={i}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs font-medium text-muted-foreground">{k.label}</CardTitle>
                {k.icon && (
                  <div className={`h-8 w-8 rounded-md flex items-center justify-center ${k.tone ?? "bg-primary"}`}>
                    <k.icon className="h-4 w-4 text-white" />
                  </div>
                )}
              </CardHeader>
              <CardContent><div className="text-xl font-bold"><LoadingValue loading={loading}>{k.value}</LoadingValue></div></CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Table */}
      <Card className="p-4">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {result?.columns.map((c) => (
                  <TableHead key={c.key} className={c.align === "right" ? "text-end" : ""}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={result?.columns.length ?? 1} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !result || result.rows.length === 0 ? (
                <TableRow><TableCell colSpan={result?.columns.length ?? 1} className="text-center py-10 text-muted-foreground">No data for the selected filters.</TableCell></TableRow>
              ) : (
                result.rows.map((r, i) => (
                  <TableRow key={i}>
                    {result.columns.map((c) => (
                      <TableCell key={c.key} className={c.align === "right" ? "text-end" : ""}>
                        {fmt(r[c.key], c.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {result && result.totals.length > 0 && result.rows.length > 0 && (
          <div className="mt-4 pt-4 border-t flex flex-wrap gap-x-8 gap-y-2 justify-end">
            {result.totals.map((t, i) => (
              <div key={i} className="text-sm">
                <span className="text-muted-foreground">{t.label}: </span>
                <span className="font-semibold"><LoadingValue loading={loading} className="h-4 w-16">{t.value}</LoadingValue></span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default Reports;
