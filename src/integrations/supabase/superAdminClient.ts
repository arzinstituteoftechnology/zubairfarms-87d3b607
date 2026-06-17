// Dedicated Super Admin Supabase client with an isolated session storage key.
// This keeps Super Admin authentication completely separate from Tenant auth,
// so both sessions can co-exist in the same browser without conflict.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const SUPER_ADMIN_STORAGE_KEY = "super_admin_session";

export const supabaseSuperAdmin = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: localStorage,
      storageKey: SUPER_ADMIN_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);