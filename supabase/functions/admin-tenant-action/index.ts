import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action =
  | { action: "reset_password"; user_id: string; new_password: string }
  | { action: "delete_tenant"; tenant_id: string }
  | { action: "suspend_tenant"; tenant_id: string }
  | { action: "activate_tenant"; tenant_id: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(url, service);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body: Action = await req.json();

    if (body.action === "reset_password") {
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.new_password });
      if (error) throw new Error(error.message);
    } else if (body.action === "suspend_tenant") {
      await admin.from("tenants").update({ status: "suspended" }).eq("id", body.tenant_id);
    } else if (body.action === "activate_tenant") {
      await admin.from("tenants").update({ status: "active" }).eq("id", body.tenant_id);
    } else if (body.action === "delete_tenant") {
      const { data: tu } = await admin.from("tenant_users").select("user_id").eq("tenant_id", body.tenant_id);
      await admin.from("tenants").delete().eq("id", body.tenant_id);
      for (const row of tu ?? []) {
        await admin.auth.admin.deleteUser(row.user_id).catch(() => {});
      }
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});