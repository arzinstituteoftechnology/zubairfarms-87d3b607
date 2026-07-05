import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "owner" | "manager" | "cashier" | "data_entry" | "read_only";
const ALLOWED: Role[] = ["owner", "manager", "cashier", "data_entry", "read_only"];

interface Body {
  full_name: string; email: string; password: string; tenant_role: Role;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(url, service);

    // Verify caller is an active Owner and get their tenant
    const { data: caller, error: callerErr } = await admin.from("tenant_users")
      .select("tenant_id, tenant_role, status").eq("user_id", user.id).maybeSingle();
    if (callerErr || !caller) return json({ error: "No tenant link" }, 403);
    if (caller.tenant_role !== "owner" || caller.status !== "active") {
      await admin.from("activity_logs").insert({
        actor_user_id: user.id, tenant_id: caller.tenant_id,
        action: "unauthorized_action_attempt", entity: "users",
        metadata: { required_action: "create" },
      });
      return json({ error: "Only the tenant Owner can create users" }, 403);
    }

    const body = await req.json() as Body;
    if (!body?.email || !body?.password || !body?.full_name || !body?.tenant_role) {
      return json({ error: "Missing full_name, email, password, tenant_role" }, 400);
    }
    if (!ALLOWED.includes(body.tenant_role)) return json({ error: "Invalid role" }, 400);
    if (body.password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    // Create or reuse auth user
    let newUserId: string | null = null;
    let created = false;
    const { data: c, error: createErr } = await admin.auth.admin.createUser({
      email: body.email, password: body.password, email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });
    if (createErr) {
      const msg = (createErr.message ?? "").toLowerCase();
      if (!(msg.includes("already") || msg.includes("exists") || (createErr as any).code === "email_exists")) {
        return json({ error: `Auth user create failed: ${createErr.message}` }, 400);
      }
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === body.email.toLowerCase());
      if (!existing) return json({ error: "Email exists but user not found" }, 500);
      const { data: link } = await admin.from("tenant_users").select("tenant_id").eq("user_id", existing.id).maybeSingle();
      if (link) return json({ error: `Email ${body.email} is already linked to another tenant.` }, 409);
      await admin.auth.admin.updateUserById(existing.id, { password: body.password, email_confirm: true });
      newUserId = existing.id;
    } else {
      newUserId = c!.user!.id;
      created = true;
    }

    // Insert profile row (idempotent)
    await admin.from("profiles").upsert({ id: newUserId!, full_name: body.full_name }, { onConflict: "id" });

    // Link to tenant
    const { error: tuErr } = await admin.from("tenant_users").insert({
      tenant_id: caller.tenant_id, user_id: newUserId, tenant_role: body.tenant_role, status: "active",
    });
    if (tuErr) {
      if (created) await admin.auth.admin.deleteUser(newUserId!).catch(() => {});
      return json({ error: `Link user to tenant failed: ${tuErr.message}` }, 400);
    }

    await admin.from("activity_logs").insert({
      actor_user_id: user.id, tenant_id: caller.tenant_id,
      action: "tenant_user.create", entity: "tenant_users", entity_id: newUserId,
      metadata: { email: body.email, role: body.tenant_role, full_name: body.full_name },
    });

    return json({ ok: true, user_id: newUserId, reused_user: !created });
  } catch (e) {
    console.error("owner-create-tenant-user fatal:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});