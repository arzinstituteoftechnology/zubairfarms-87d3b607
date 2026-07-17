import { supabase } from "@/integrations/supabase/client";
import { normalizePkPhone, renderTemplate } from "@/lib/phone";

export type SmsRecipientType = "admin" | "customer" | "shop" | "farm" | "supplier" | "user";

export interface QueueSmsInput {
  tenantId: string;
  eventType: string;
  relatedTable?: string;
  relatedRecordId?: string;
  recipientType: SmsRecipientType;
  recipientName?: string;
  phoneNumber: string;
  templateVariables?: Record<string, unknown>;
  fallbackMessage?: string;
  idempotencyKey?: string;
}

export interface QueueSmsResult {
  ok: boolean;
  skipped?: "disabled" | "no_phone" | "no_template" | "recipient_disabled" | "duplicate";
  queueId?: string;
  error?: string;
}

/**
 * Queue an SMS notification. Never throws — SMS is a side effect and
 * MUST NOT roll back or block accounting transactions.
 */
export async function queueSmsNotification(input: QueueSmsInput): Promise<QueueSmsResult> {
  try {
    const { data: settings } = await supabase
      .from("sms_settings" as any)
      .select("*")
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    const s = settings as any;

    if (!s || !s.is_enabled) return { ok: false, skipped: "disabled" };
    if (input.recipientType === "admin" && !s.notify_admin) return { ok: false, skipped: "recipient_disabled" };
    if (input.recipientType !== "admin" && !s.notify_customer) return { ok: false, skipped: "recipient_disabled" };

    const phone = normalizePkPhone(input.phoneNumber);
    if (!phone) return { ok: false, skipped: "no_phone" };

    const { data: tpl } = await supabase
      .from("sms_templates" as any)
      .select("message_body,is_active")
      .eq("tenant_id", input.tenantId)
      .eq("event_type", input.eventType)
      .eq("recipient_type", input.recipientType)
      .eq("is_active", true)
      .maybeSingle();

    const body = (tpl as any)?.message_body ?? input.fallbackMessage;
    if (!body) return { ok: false, skipped: "no_template" };
    const message = renderTemplate(body, input.templateVariables ?? {});

    const idem = input.idempotencyKey ??
      `${input.eventType}:${input.relatedRecordId ?? "na"}:${input.recipientType}`;

    const { data: row, error } = await supabase
      .from("sms_queue" as any)
      .upsert({
        tenant_id: input.tenantId,
        event_type: input.eventType,
        related_table: input.relatedTable ?? null,
        related_record_id: input.relatedRecordId ?? null,
        recipient_type: input.recipientType,
        recipient_name: input.recipientName ?? null,
        phone_number: phone,
        message_body: message,
        idempotency_key: idem,
        status: "pending",
      }, { onConflict: "tenant_id,idempotency_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!row) return { ok: false, skipped: "duplicate" };

    void supabase.functions.invoke("send-sms", { body: { queue_id: (row as any).id } })
      .catch(() => { /* SMS must not block business flow */ });

    return { ok: true, queueId: (row as any).id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}