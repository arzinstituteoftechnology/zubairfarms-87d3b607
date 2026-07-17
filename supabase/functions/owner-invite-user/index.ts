import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "owner" | "manager" | "cashier" | "data_entry" | "read_only";
const ALLOWED: Role[] = ["owner", "manager", "cashier", "data_entry", "read_only"];

function randomToken(bytes = 48): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(url, service);
    const { data: caller } = await admin.from("tenant_users")
      .select("tenant_id, tenant_role, status").eq("user_id", user.id).maybeSingle();
    if (!caller || caller.tenant_role !== "owner" || caller.status !== "active") {
      return json({ error: "Only the tenant Owner can invite users" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "invite";

    // --- RESEND ---
    if (action === "resend") {
      const id = String(body.invitation_id ?? "");
      if (!id) return json({ error: "invitation_id required" }, 400);
      const { data: inv } = await admin.from("user_invitations").select("*").eq("id", id).maybeSingle();
      if (!inv || inv.tenant_id !== caller.tenant_id) return json({ error: "Invitation not found" }, 404);
      if (inv.status !== "pending") return json({ error: `Cannot resend a ${inv.status} invitation` }, 400);
      const token = randomToken();
      const token_hash = await sha256(token);
      await admin.from("user_invitations").update({
        token_hash,
        expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        sent_at: new Date().toISOString(),
        resend_count: (inv.resend_count ?? 0) + 1,
      }).eq("id", id);
      const meta = req.headers.get("origin") ?? "";
      return json({ ok: true, invitation_id: id, accept_url: `${meta}/invite/accept?token=${token}` });
    }

    // --- REVOKE ---
    if (action === "revoke") {
      const id = String(body.invitation_id ?? "");
      if (!id) return json({ error: "invitation_id required" }, 400);
      const { data: inv } = await admin.from("user_invitations").select("*").eq("id", id).maybeSingle();
      if (!inv || inv.tenant_id !== caller.tenant_id) return json({ error: "Invitation not found" }, 404);
      if (inv.status !== "pending") return json({ error: `Cannot revoke a ${inv.status} invitation` }, 400);
      await admin.from("user_invitations").update({
        status: "cancelled", cancelled_at: new Date().toISOString(),
      }).eq("id", id);
      await admin.from("permission_audit_log").insert({
        tenant_id: caller.tenant_id, actor_user_id: user.id, actor_email: user.email,
        target_email: inv.email, action: "invite_revoked",
      });
      return json({ ok: true });
    }

    // --- INVITE (create) ---
    const email = String(body.email ?? "").trim().toLowerCase();
    const full_name = String(body.full_name ?? "").trim();
    const tenant_role = body.tenant_role as Role;
    if (!email || !full_name || !tenant_role) return json({ error: "Missing full_name, email, tenant_role" }, 400);
    if (!ALLOWED.includes(tenant_role)) return json({ error: "Invalid role" }, 400);

    // Reject if already an active pending invite exists (unique index also enforces this)
    const { data: existingInv } = await admin.from("user_invitations")
      .select("id").eq("tenant_id", caller.tenant_id).eq("status", "pending")
      .filter("email", "ilike", email).maybeSingle();
    if (existingInv) return json({ error: "A pending invitation already exists for this email" }, 409);

    // Reject if user already linked to this tenant
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existingAuth = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (existingAuth) {
      const { data: link } = await admin.from("tenant_users").select("tenant_id").eq("user_id", existingAuth.id).maybeSingle();
      if (link) return json({ error: "This email already belongs to a tenant user" }, 409);
    }

    const token = randomToken();
    const token_hash = await sha256(token);
    const { data: inserted, error: insErr } = await admin.from("user_invitations").insert({
      tenant_id: caller.tenant_id, email, full_name, tenant_role,
      token_hash, invited_by: user.id,
    }).select("id").maybeSingle();
    if (insErr || !inserted) return json({ error: insErr?.message ?? "Failed to create invitation" }, 400);

    await admin.from("permission_audit_log").insert({
      tenant_id: caller.tenant_id, actor_user_id: user.id, actor_email: user.email,
      target_email: email, action: "invite_sent",
      new_value: { tenant_role, full_name },
    });

    const origin = req.headers.get("origin") ?? "";
    const accept_url = `${origin}/invite/accept?token=${token}`;
    return json({ ok: true, invitation_id: inserted.id, accept_url, token });
  } catch (e) {
    console.error("owner-invite-user fatal:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});