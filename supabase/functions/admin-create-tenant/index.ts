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

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(url, service);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — super admin only" }, 403);

    const body: Body = await req.json();
    if (!body.email || !body.password || !body.company_name || !body.owner_name) {
      return json({ error: "Missing required fields (company_name, owner_name, email, password)" }, 400);
    }

    // 1. Create or reuse auth user
    let newUserId: string | null = null;
    let createdNewUser = false;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.owner_name },
    });
    if (createErr) {
      const msg = (createErr.message ?? "").toLowerCase();
      const isExists = msg.includes("already") || msg.includes("exists") || (createErr as any).code === "email_exists";
      if (!isExists) {
        console.error("createUser failed:", createErr);
        return json({ error: `Auth user create failed: ${createErr.message}` }, 400);
      }
      // Find existing user and reuse only if not already linked to a tenant
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (listErr) return json({ error: `Lookup failed: ${listErr.message}` }, 500);
      const existing = list.users.find((u) => u.email?.toLowerCase() === body.email.toLowerCase());
      if (!existing) return json({ error: "Email exists in auth but user not found" }, 500);
      const { data: link } = await admin.from("tenant_users").select("tenant_id").eq("user_id", existing.id).maybeSingle();
      if (link) return json({ error: `Email ${body.email} is already linked to another tenant. Use a different email.` }, 409);
      // Reset password to the one provided so admin's chosen password works
      await admin.auth.admin.updateUserById(existing.id, { password: body.password, email_confirm: true });
      newUserId = existing.id;
    } else {
      newUserId = created!.user!.id;
      createdNewUser = true;
    }

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
      console.error("tenant insert failed:", tenantErr);
      if (createdNewUser) await admin.auth.admin.deleteUser(newUserId!).catch(() => {});
      return json({ error: `Tenant create failed: ${tenantErr?.message ?? "unknown"}` }, 400);
    }

    // 3. Link user to tenant as admin
    const { error: tuErr } = await admin.from("tenant_users").insert({ tenant_id: tenant.id, user_id: newUserId, tenant_role: "owner", status: "active" });
    if (tuErr) {
      console.error("tenant_users insert failed:", tuErr);
      await admin.from("tenants").delete().eq("id", tenant.id);
      if (createdNewUser) await admin.auth.admin.deleteUser(newUserId!).catch(() => {});
      return json({ error: `Link user→tenant failed: ${tuErr.message}` }, 400);
    }
    // 4. Grant app role 'admin' for in-app gating (ignore if already exists)
    await admin.from("user_roles").insert({ user_id: newUserId, role: "admin" }).then(({ error }) => {
      if (error && !error.message.toLowerCase().includes("duplicate")) console.error("user_roles insert:", error);
    });

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
        const { error: subErr } = await admin.from("subscriptions").insert({
          tenant_id: tenant.id,
          plan_id: plan.id,
          expires_at: expires.toISOString(),
          status: plan.billing_cycle === "trial" ? "trial" : "active",
        });
        if (subErr) console.error("subscription insert failed:", subErr);
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

    return json({ ok: true, tenant, user_id: newUserId, reused_user: !createdNewUser });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("admin-create-tenant fatal:", e);
    return json({ error: msg }, 500);
  }
});