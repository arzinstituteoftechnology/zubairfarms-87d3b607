import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

let cached: { customers_module_enabled: boolean } | null = null;
const listeners = new Set<(v: { customers_module_enabled: boolean }) => void>();

async function load() {
  const { data } = await supabase
    .from("system_settings")
    .select("customers_module_enabled")
    .eq("id", 1)
    .maybeSingle();
  cached = { customers_module_enabled: !!(data as any)?.customers_module_enabled };
  listeners.forEach((l) => l(cached!));
  return cached;
}

export function refreshModuleFlags() {
  return load();
}

export function useModuleFlags() {
  const [flags, setFlags] = useState<{ customers_module_enabled: boolean }>(
    cached ?? { customers_module_enabled: false }
  );
  useEffect(() => {
    listeners.add(setFlags);
    if (!cached) load();
    else setFlags(cached);
    return () => {
      listeners.delete(setFlags);
    };
  }, []);
  return flags;
}