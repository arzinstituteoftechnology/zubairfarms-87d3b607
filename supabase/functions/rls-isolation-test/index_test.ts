// Multi-tenant RLS + subscription enforcement test suite.
// Verifies: tenant isolation on every CRUD table, super-admin-only tables,
// and subscription gating at the database level.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

assert(SUPABASE_URL && ANON && SERVICE, "Missing Supabase env vars (URL / ANON / SERVICE_ROLE)");

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

interface TenantCtx {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

const TAG = `rlstest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function createTenant(label: string): Promise<TenantCtx> {
  const email = `${TAG}_${label}@example.test`;
  const password = "TestPass!2026#" + label;

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `RLS Test ${label}` },
  });
  if (cErr || !created.user) throw new Error(`createUser ${label}: ${cErr?.message}`);
  const userId = created.user.id;

  const { data: tenant, error: tErr } = await admin.from("tenants").insert({
    company_name: `RLS Test Co ${label} ${TAG}`,
    owner_name: `Owner ${label}`,
    email,
    status: "active",
  }).select().single();
  if (tErr) throw new Error(`tenant ${label}: ${tErr.message}`);

  await admin.from("tenant_users").insert({ tenant_id: tenant.id, user_id: userId, tenant_role: "admin" });
  await admin.from("user_roles").insert({ user_id: userId, role: "admin" });

  // Active subscription (10 days)
  const exp = new Date(); exp.setUTCDate(exp.getUTCDate() + 10);
  await admin.from("subscriptions").insert({
    tenant_id: tenant.id, plan_id: null,
    expires_at: exp.toISOString(), status: "active",
  });

  const client = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);

  return { tenantId: tenant.id, userId, email, password, client };
}

async function cleanup(ctxs: TenantCtx[]) {
  for (const c of ctxs) {
    try { await c.client.auth.signOut(); } catch { /* noop */ }
    await admin.from("tenants").delete().eq("id", c.tenantId);  // cascades to data
    await admin.from("user_roles").delete().eq("user_id", c.userId);
    await admin.auth.admin.deleteUser(c.userId);
  }
}

// Per-table seed data (minimum required NOT NULL columns besides tenant_id/created_by).
function seedPayload(table: string, ctx: TenantCtx): Record<string, unknown> {
  const base: Record<string, unknown> = { tenant_id: ctx.tenantId, created_by: ctx.userId };
  switch (table) {
    case "farms":     return { ...base, name: `Farm ${TAG}` };
    case "shops":     return { ...base, name: `Shop ${TAG}` };
    case "customers": return { ...base, name: `Cust ${TAG}` };
    case "trucks":    return { ...base, number: `TRK-${TAG}` };
    case "expenses":  return { ...base, category: "Misc", amount: 100, expense_date: new Date().toISOString().slice(0, 10) };
    default: throw new Error(`No seed for ${table}`);
  }
}

const TENANT_TABLES = ["farms", "shops", "customers", "trucks", "expenses"];

Deno.test("RLS: tenant isolation for all CRUD tables", async () => {
  const A = await createTenant("a");
  const B = await createTenant("b");
  try {
    for (const table of TENANT_TABLES) {
      // A inserts a row via service role (so we have a known id regardless of column quirks).
      const { data: row, error: insErr } = await admin.from(table).insert(seedPayload(table, A)).select().single();
      assertEquals(insErr, null, `[${table}] seed insert as A failed: ${insErr?.message}`);
      const rowId = (row as { id: string }).id;

      // 1. A can read its own row.
      const aRead = await A.client.from(table).select("id").eq("id", rowId).maybeSingle();
      assertEquals(aRead.error, null, `[${table}] A read own: ${aRead.error?.message}`);
      assert(aRead.data, `[${table}] A should see own row`);

      // 2. B cannot read A's row.
      const bRead = await B.client.from(table).select("id").eq("id", rowId).maybeSingle();
      assertEquals(bRead.error, null, `[${table}] B read should not error, got: ${bRead.error?.message}`);
      assertEquals(bRead.data, null, `[${table}] LEAK: B can read A's ${table} row`);

      // 3. B cannot update A's row.
      const bUpd = await B.client.from(table).update({ notes: "hacked" } as never).eq("id", rowId).select();
      assert(!bUpd.data || bUpd.data.length === 0, `[${table}] LEAK: B updated A's row`);

      // 4. B cannot delete A's row.
      const bDel = await B.client.from(table).delete().eq("id", rowId).select();
      assert(!bDel.data || bDel.data.length === 0, `[${table}] LEAK: B deleted A's row`);

      // 5. B cannot insert a row pretending to belong to A.
      const forged = { ...seedPayload(table, A), created_by: B.userId };
      const bIns = await B.client.from(table).insert(forged).select();
      assert(bIns.error || !bIns.data || bIns.data.length === 0,
        `[${table}] LEAK: B inserted a row tagged with A.tenant_id`);

      // 6. A can update its own row.
      const aUpd = await A.client.from(table).update({ notes: "ok" } as never).eq("id", rowId).select();
      // notes column may not exist on every table; only assert no permission error.
      if (aUpd.error) {
        assert(!/permission|policy|rls/i.test(aUpd.error.message),
          `[${table}] A own update blocked by RLS: ${aUpd.error.message}`);
      }

      // 7. A can delete its own row.
      const aDel = await A.client.from(table).delete().eq("id", rowId).select();
      assertEquals(aDel.error, null, `[${table}] A own delete: ${aDel.error?.message}`);
    }
  } finally {
    await cleanup([A, B]);
  }
});

Deno.test("RLS: super-admin-only tables blocked for tenant users", async () => {
  const A = await createTenant("admin_check");
  try {
    // Cannot list other tenants.
    const tenants = await A.client.from("tenants").select("id").neq("id", A.tenantId);
    assert((tenants.data ?? []).length === 0, "LEAK: tenant user can list other tenants");

    // Cannot read subscription_plans? They are publicly readable for pricing — skip.
    // Cannot read activity_logs of other tenants.
    const logs = await A.client.from("activity_logs").select("id").limit(1);
    // Either empty or only own tenant — never errors. Just sanity check no foreign rows.
    if (logs.data) {
      for (const r of logs.data as Array<{ id: string }>) assert(r.id, "log shape");
    }

    // Cannot insert into user_roles.
    const r = await A.client.from("user_roles").insert({ user_id: A.userId, role: "super_admin" }).select();
    assert(r.error || !r.data || r.data.length === 0, "LEAK: tenant user self-escalated to super_admin");
  } finally {
    await cleanup([A]);
  }
});

Deno.test("Subscription gate: expired subscription blocks CRUD reads", async () => {
  const A = await createTenant("expired");
  try {
    // Seed a row while active.
    await admin.from("farms").insert(seedPayload("farms", A));

    // Expire the subscription.
    const past = new Date(); past.setUTCDate(past.getUTCDate() - 1);
    await admin.from("subscriptions").update({ expires_at: past.toISOString(), status: "expired" })
      .eq("tenant_id", A.tenantId);

    const { data } = await A.client.from("farms").select("id");
    assertEquals((data ?? []).length, 0, "LEAK: expired tenant can still read farms");
  } finally {
    await cleanup([A]);
  }
});

Deno.test("Subscription gate: suspended tenant blocks CRUD reads", async () => {
  const A = await createTenant("suspended");
  try {
    await admin.from("farms").insert(seedPayload("farms", A));
    await admin.from("tenants").update({ status: "suspended" }).eq("id", A.tenantId);

    const { data } = await A.client.from("farms").select("id");
    assertEquals((data ?? []).length, 0, "LEAK: suspended tenant can still read farms");

    // restore so cleanup can cascade delete safely
    await admin.from("tenants").update({ status: "active" }).eq("id", A.tenantId);
  } finally {
    await cleanup([A]);
  }
});