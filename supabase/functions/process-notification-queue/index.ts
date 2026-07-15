// Notification email queue processor.
// Provider is abstracted so email delivery can be enabled later
// without changing schema, triggers, or business logic.
//
// Status: Pending Production Setup — no live provider is configured.
// When ready, implement `sendViaProvider` (e.g. Resend/Postmark) and set
// EMAIL_PROVIDER=live via secrets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type QueueRow = {
  id: string;
  tenant_id: string | null;
  recipient_email: string;
  template: string;
  template_data: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  status: string;
};

const MAX_BATCH = 50;

function renderTemplate(template: string, data: Record<string, unknown>) {
  const title = String(data.title ?? "Notification");
  const message = String(data.message ?? "");
  const priority = String(data.priority ?? "normal");
  const module = String(data.module ?? "");
  const subject = `[${priority.toUpperCase()}] ${title}`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f6f7f9;padding:24px">
    <table style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px">
      <tr><td>
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#64748b">${module} · ${priority}</div>
        <h2 style="margin:8px 0 12px 0;color:#0f172a">${title}</h2>
        <p style="color:#334155;line-height:1.5;white-space:pre-wrap">${message}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
        <div style="font-size:12px;color:#94a3b8">Template: ${template}</div>
      </td></tr>
    </table>
  </body></html>`;
  const text = `${title}\n\n${message}\n\n(${module} · ${priority})`;
  return { subject, html, text };
}

async function sendViaProvider(
  _to: string,
  _rendered: { subject: string; html: string; text: string },
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  const provider = Deno.env.get("EMAIL_PROVIDER") ?? "pending";
  // Live provider hook: implement here (Resend/Postmark/SES) once configured.
  if (provider === "pending" || provider === "") {
    return { ok: false, error: "email_provider_pending_production_setup" };
  }
  return { ok: false, error: `unknown_email_provider:${provider}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await supabase
    .from("email_notification_queue")
    .select("*")
    .eq("status", "pending")
    .lte("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const r of (rows ?? []) as QueueRow[]) {
    const rendered = renderTemplate(r.template, r.template_data ?? {});
    const result = await sendViaProvider(r.recipient_email, rendered);
    const attempts = (r.attempts ?? 0) + 1;

    if (result.ok) {
      await supabase.from("email_notification_queue").update({
        status: "sent", attempts, sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId ?? null, last_error: null,
      }).eq("id", r.id);
      sent++;
    } else if (result.error === "email_provider_pending_production_setup") {
      // Keep row pending, don't count as failure. Bump attempts to surface stalled rows.
      await supabase.from("email_notification_queue").update({
        status: "pending", last_error: result.error, attempts,
      }).eq("id", r.id);
      skipped++;
    } else if (attempts >= (r.max_attempts ?? 5)) {
      await supabase.from("email_notification_queue").update({
        status: "failed", attempts, last_error: result.error ?? "unknown",
      }).eq("id", r.id);
      failed++;
    } else {
      await supabase.from("email_notification_queue").update({
        status: "pending", attempts, last_error: result.error ?? "unknown",
      }).eq("id", r.id);
      failed++;
    }
  }

  await supabase.from("activity_logs").insert({
    action: "notification_queue_processed",
    entity: "email_notification_queue",
    metadata: { sent, failed, skipped, batch: rows?.length ?? 0, provider: Deno.env.get("EMAIL_PROVIDER") ?? "pending" },
  });

  return new Response(JSON.stringify({ processed: rows?.length ?? 0, sent, failed, skipped }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});