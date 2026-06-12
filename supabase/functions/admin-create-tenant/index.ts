import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  company_name: string;
  farm_name?: string;
  owner_name: string;
  mobile?: string;
  email: string;
  password: string;
  country?: string;
  city?: string;
  plan_id?: string | null;
}

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
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden — super admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body: Body = await req.json();
    if (!body.email || !body.password || !body.company_name || !body.owner_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Create auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.owner_name },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "Failed to create user");
    const newUserId = created.user.id;

    // 2. Create tenant
    const { data: tenant, error: tenantErr } = await admin.from("tenants").insert({
      company_name: body.company_name,
      farm_name: body.farm_name ?? null,
      owner_name: body.owner_name,
      mobile: body.mobile ?? null,
      email: body.email,
      country: body.country ?? null,
      city: body.city ?? null,
      status: "active",
    }).select().single();
    if (tenantErr || !tenant) {
      await admin.auth.admin.deleteUser(newUserId);
      throw new Error(tenantErr?.message ?? "Failed to create tenant");
    }

    // 3. Link user to tenant as admin
    await admin.from("tenant_users").insert({ tenant_id: tenant.id, user_id: newUserId, tenant_role: "admin" });
    // 4. Grant app role 'admin' for in-app gating
    await admin.from("user_roles").insert({ user_id: newUserId, role: "admin" });

    // 5. Create subscription if plan provided (else free trial default)
    let planId = body.plan_id ?? null;
    if (!planId) {
      const { data: trial } = await admin.from("subscription_plans").select("id").eq("billing_cycle", "trial").eq("is_active", true).limit(1).maybeSingle();
      planId = trial?.id ?? null;
    }
    if (planId) {
      const { data: plan } = await admin.from("subscription_plans").select("*").eq("id", planId).single();
      if (plan) {
        const expires = new Date();
        expires.setUTCDate(expires.getUTCDate() + (plan.duration_days ?? 30));
        await admin.from("subscriptions").insert({
          tenant_id: tenant.id,
          plan_id: plan.id,
          expires_at: expires.toISOString(),
          status: plan.billing_cycle === "trial" ? "trial" : "active",
        });
      }
    }

    // 6. Log
    await admin.from("activity_logs").insert({
      actor_user_id: user.id,
      tenant_id: tenant.id,
      action: "tenant.create",
      entity: "tenant",
      entity_id: tenant.id,
      metadata: { email: body.email },
    });

    return new Response(JSON.stringify({ tenant, user_id: newUserId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});