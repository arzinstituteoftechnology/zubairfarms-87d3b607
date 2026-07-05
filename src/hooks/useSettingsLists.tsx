import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MeatTypeRow = { id: string; name: string; color: string; display_order: number; is_active: boolean };
export type UnitRow = { id: string; code: string; name: string; display_order: number; is_active: boolean; is_system: boolean };
export type PaymentMethodRow = { id: string; code: string; name: string; display_order: number; is_active: boolean; is_system: boolean };
export type ExpenseCategoryRow = { id: string; name: string; display_order: number; is_active: boolean };
export type AdjustmentReasonRow = { id: string; code: string; name: string; display_order: number; is_active: boolean; is_system: boolean };
export type BusinessProfile = {
  id?: string; tenant_id?: string;
  company_name?: string | null; logo_url?: string | null; address?: string | null;
  phone?: string | null; whatsapp?: string | null; email?: string | null;
  ntn?: string | null; strn?: string | null;
  currency?: string | null; time_zone?: string | null;
};

export interface SettingsLists {
  loading: boolean;
  meatTypes: MeatTypeRow[];
  units: UnitRow[];
  paymentMethods: PaymentMethodRow[];
  expenseCategories: ExpenseCategoryRow[];
  adjustmentReasons: AdjustmentReasonRow[];
  businessProfile: BusinessProfile | null;
  reload: () => Promise<void>;
}

const FALLBACK_MEATS: MeatTypeRow[] = ["Beef","Mutton","Goat","Chicken","Lamb","Buffalo"].map((n, i) => ({
  id: `fallback-${n}`, name: n, color: "#64748b", display_order: i + 1, is_active: true,
}));

export function useSettingsLists(): SettingsLists {
  const [state, setState] = useState<Omit<SettingsLists, "reload">>({
    loading: true,
    meatTypes: FALLBACK_MEATS,
    units: [], paymentMethods: [], expenseCategories: [], adjustmentReasons: [],
    businessProfile: null,
  });

  const load = useCallback(async () => {
    const [mt, un, pm, ec, ar, bp] = await Promise.all([
      (supabase as any).from("meat_types").select("*").order("display_order"),
      (supabase as any).from("units").select("*").order("display_order"),
      (supabase as any).from("payment_methods").select("*").order("display_order"),
      (supabase as any).from("expense_categories").select("*").order("display_order"),
      (supabase as any).from("stock_adjustment_reasons").select("*").order("display_order"),
      (supabase as any).from("business_profiles").select("*").maybeSingle(),
    ]);
    setState({
      loading: false,
      meatTypes: (mt.data && mt.data.length ? mt.data : FALLBACK_MEATS) as MeatTypeRow[],
      units: (un.data ?? []) as UnitRow[],
      paymentMethods: (pm.data ?? []) as PaymentMethodRow[],
      expenseCategories: (ec.data ?? []) as ExpenseCategoryRow[],
      adjustmentReasons: (ar.data ?? []) as AdjustmentReasonRow[],
      businessProfile: (bp.data ?? null) as BusinessProfile | null,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel("settings-lists-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meat_types" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "units" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_methods" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_categories" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_adjustment_reasons" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "business_profiles" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return { ...state, reload: load };
}

export const activeOnly = <T extends { is_active: boolean }>(rows: T[]) => rows.filter(r => r.is_active);