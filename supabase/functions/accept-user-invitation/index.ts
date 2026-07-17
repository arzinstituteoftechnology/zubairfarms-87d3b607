import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

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
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    const password = String(body.password ?? "");
    const full_name = String(body.full_name ?? "").trim();
    const preview = Boolean(body.preview);

    if (!token) return json({ error: "Token required" }, 400);
    const token_hash = await sha256(token);

    const { data: inv } = await admin.from("user_invitations")
      .select("*").eq("token_hash", token_hash).maybeSingle();
    if (!inv) return json({ error: "Invitation not found" }, 404);

    if (inv.status !== "pending") return json({ error: `Invitation ${inv.status}` }, 400);
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      await admin.from("user_invitations").update({ status: "expired" }).eq("id", inv.id);
      return json({ error: "Invitation expired" }, 400);
    }

    if (preview) {
      return json({ ok: true, email: inv.email, full_name: inv.full_name, tenant_role: inv.tenant_role });
    }

    if (!password || password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    // Create or reuse auth user
    let userId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: inv.email, password, email_confirm: true,
      user_metadata: { full_name: full_name || inv.full_name || inv.email },
    });
    if (createErr) {
      const msg = (createErr.message ?? "").toLowerCase();
      if (!(msg.includes("already") || msg.includes("exists"))) {
        return json({ error: `Auth user create failed: ${createErr.message}` }, 400);
      }
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === inv.email.toLowerCase());
      if (!existing) return json({ error: "Failed to locate existing account" }, 500);
      await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      userId = existing.id;
    } else {
      userId = created!.user!.id;
    }

    await admin.from("profiles").upsert({
      id: userId!, full_name: full_name || inv.full_name || inv.email,
      must_change_password: false,
    }, { onConflict: "id" });

    // Link to tenant (idempotent)
    const { error: linkErr } = await admin.from("tenant_users").insert({
      tenant_id: inv.tenant_id, user_id: userId, tenant_role: inv.tenant_role, status: "active",
      role_template_id: inv.role_template_id,
    });
    if (linkErr && !linkErr.message.toLowerCase().includes("duplicate")) {
      return json({ error: `Link failed: ${linkErr.message}` }, 400);
    }

    await admin.from("user_invitations").update({
      status: "accepted", accepted_at: new Date().toISOString(), accepted_user_id: userId,
    }).eq("id", inv.id);

    await admin.from("permission_audit_log").insert({
      tenant_id: inv.tenant_id, target_user_id: userId, target_email: inv.email,
      action: "invite_accepted", new_value: { tenant_role: inv.tenant_role },
    });

    return json({ ok: true, email: inv.email });
  } catch (e) {
    console.error("accept-user-invitation fatal:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});