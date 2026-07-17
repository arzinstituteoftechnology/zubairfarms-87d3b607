// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * send-sms edge function
 *
 * Reads provider credentials only from Supabase Secrets. Never returns
 * the raw provider secret in the response body or logs.
 *
 * Body:
 *   { queue_id: string }  — process a specific queued row (preferred), OR
 *   { tenant_id, phone_number, message_body, event_type, ... } — ad-hoc test send
 */

type ProviderName = "twilio" | "gatewayapi" | "generic_http";

interface SendResult {
  ok: boolean;
  provider_message_id?: string;
  provider_status?: string;
  error_code?: string;
  error_message?: string;
  raw?: unknown;
}

interface SmsProvider {
  name: ProviderName;
  send(to: string, body: string, senderId?: string): Promise<SendResult>;
}

// -------------------- Providers --------------------

function TwilioProvider(): SmsProvider {
  const accountSid = Deno.env.get("SMS_ACCOUNT_ID") ?? "";
  const authToken = Deno.env.get("SMS_AUTH_TOKEN") ?? "";
  const from = Deno.env.get("SMS_SENDER_ID") ?? "";
  return {
    name: "twilio",
    async send(to, body, senderId) {
      if (!accountSid || !authToken) return { ok: false, error_code: "config", error_message: "Twilio credentials missing" };
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const form = new URLSearchParams({ To: to, From: senderId || from, Body: body });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error_code: String(json.code ?? res.status), error_message: json.message ?? "twilio error", raw: json };
      return { ok: true, provider_message_id: json.sid, provider_status: json.status, raw: json };
    },
  };
}

function GatewayApiProvider(): SmsProvider {
  const token = Deno.env.get("SMS_AUTH_TOKEN") ?? "";
  const sender = Deno.env.get("SMS_SENDER_ID") ?? "MeatFlow";
  const apiUrl = Deno.env.get("SMS_API_URL") ?? "https://gatewayapi.com/rest/mtsms";
  return {
    name: "gatewayapi",
    async send(to, body, senderId) {
      if (!token) return { ok: false, error_code: "config", error_message: "GatewayAPI token missing" };
      const digits = to.replace(/[^0-9]/g, "");
      const payload = {
        sender: senderId || sender,
        message: body,
        recipients: [{ msisdn: Number(digits) }],
      };
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error_code: String(res.status), error_message: json?.message ?? "gatewayapi error", raw: json };
      const id = Array.isArray(json?.ids) ? String(json.ids[0]) : undefined;
      return { ok: true, provider_message_id: id, provider_status: "queued", raw: json };
    },
  };
}

function GenericHttpProvider(): SmsProvider {
  const apiUrl = Deno.env.get("SMS_API_URL") ?? "";
  const token = Deno.env.get("SMS_AUTH_TOKEN") ?? "";
  const sender = Deno.env.get("SMS_SENDER_ID") ?? "";
  return {
    name: "generic_http",
    async send(to, body, senderId) {
      if (!apiUrl) return { ok: false, error_code: "config", error_message: "SMS_API_URL missing" };
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ to, from: senderId || sender, message: body }),
      });
      const text = await res.text();
      let raw: unknown = text;
      try { raw = JSON.parse(text); } catch { /* keep text */ }
      if (!res.ok) return { ok: false, error_code: String(res.status), error_message: text.slice(0, 500), raw };
      const anyJson = raw as any;
      return { ok: true, provider_message_id: anyJson?.id ?? anyJson?.message_id, provider_status: anyJson?.status ?? "sent", raw };
    },
  };
}

function pickProvider(): SmsProvider {
  const name = (Deno.env.get("SMS_PROVIDER") ?? "gatewayapi").toLowerCase() as ProviderName;
  if (name === "twilio") return TwilioProvider();
  if (name === "generic_http") return GenericHttpProvider();
  return GatewayApiProvider();
}

// -------------------- Helpers --------------------

function normalizePkPhone(input: string): string | null {
  if (!input) return null;
  const raw = input.replace(/[\s\-()]/g, "");
  if (/^\+92\d{10}$/.test(raw)) return raw;
  if (/^92\d{10}$/.test(raw)) return "+" + raw;
  if (/^03\d{9}$/.test(raw)) return "+92" + raw.slice(1);
  if (/^\+\d{8,15}$/.test(raw)) return raw; // other E.164
  return null;
}

function maskPhone(p: string): string {
  if (!p) return "";
  if (p.length <= 6) return "***";
  return p.slice(0, 5) + "****" + p.slice(-2);
}

// -------------------- Handler --------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let queueRow: any | null = null;

    if (body.queue_id) {
      const { data, error } = await supabase.from("sms_queue").select("*").eq("id", body.queue_id).maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "queue row not found");
      queueRow = data;
    } else {
      // ad-hoc / test send — insert a queue row first
      const phone = normalizePkPhone(body.phone_number ?? "");
      if (!phone) throw new Error("Invalid phone number");
      const idem = body.idempotency_key ?? `test:${body.tenant_id}:${crypto.randomUUID()}`;
      const { data, error } = await supabase.from("sms_queue").insert({
        tenant_id: body.tenant_id,
        event_type: body.event_type ?? "test_message",
        recipient_type: body.recipient_type ?? "admin",
        recipient_name: body.recipient_name ?? null,
        phone_number: phone,
        message_body: body.message_body ?? "MeatFlow test SMS.",
        idempotency_key: idem,
        provider: (Deno.env.get("SMS_PROVIDER") ?? "gatewayapi"),
      }).select("*").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "failed to enqueue");
      queueRow = data;
    }

    if (queueRow.status === "sent" || queueRow.status === "delivered") {
      return new Response(JSON.stringify({ ok: true, already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("sms_queue").update({ status: "processing", attempt_count: (queueRow.attempt_count ?? 0) + 1 }).eq("id", queueRow.id);

    const provider = pickProvider();
    const phone = normalizePkPhone(queueRow.phone_number);
    if (!phone) {
      await supabase.from("sms_queue").update({
        status: "skipped", failed_at: new Date().toISOString(), error_message: "Invalid phone number",
      }).eq("id", queueRow.id);
      await supabase.from("sms_delivery_logs").insert({
        tenant_id: queueRow.tenant_id, sms_queue_id: queueRow.id,
        phone_number_masked: maskPhone(queueRow.phone_number),
        event_type: queueRow.event_type, status: "skipped",
        error_message: "Invalid phone number",
      });
      return new Response(JSON.stringify({ ok: false, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    const senderId = Deno.env.get("SMS_SENDER_ID") ?? undefined;
    const result = await provider.send(phone, queueRow.message_body, senderId);

    if (result.ok) {
      await supabase.from("sms_queue").update({
        status: "sent", sent_at: new Date().toISOString(),
        provider_message_id: result.provider_message_id ?? null,
        provider_status: result.provider_status ?? "sent",
        provider: provider.name,
      }).eq("id", queueRow.id);
      await supabase.from("sms_delivery_logs").insert({
        tenant_id: queueRow.tenant_id, sms_queue_id: queueRow.id,
        provider_message_id: result.provider_message_id ?? null,
        phone_number_masked: maskPhone(phone),
        event_type: queueRow.event_type, status: "sent",
        provider_response: (result.raw ?? {}) as any,
        sent_at: new Date().toISOString(),
      });
    } else {
      const finalStatus = (queueRow.attempt_count ?? 0) + 1 >= (queueRow.max_attempts ?? 3) ? "failed" : "pending";
      await supabase.from("sms_queue").update({
        status: finalStatus,
        failed_at: finalStatus === "failed" ? new Date().toISOString() : null,
        error_message: result.error_message ?? "provider error",
        provider: provider.name,
      }).eq("id", queueRow.id);
      await supabase.from("sms_delivery_logs").insert({
        tenant_id: queueRow.tenant_id, sms_queue_id: queueRow.id,
        phone_number_masked: maskPhone(phone),
        event_type: queueRow.event_type, status: "failed",
        provider_response: (result.raw ?? {}) as any,
        error_code: result.error_code ?? null,
        error_message: result.error_message ?? null,
      });
    }

    return new Response(JSON.stringify({ ok: result.ok, provider: provider.name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  } catch (e) {
    console.error("send-sms error", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});