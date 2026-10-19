/** n8n — the mail room. Outbound: invoice email. Inbound calls are checked in lib/http.ts. */
import { config, need } from "@/lib/config";
import { postJson } from "./http";

export async function sendInvoiceEmail(payload: {
  visit_id: string;
  patient: { name: string; email: string | null };
  invoice: unknown;
}): Promise<void> {
  await postJson(need(config.n8n.invoiceWebhookUrl, "N8N_INVOICE_WEBHOOK_URL"), payload, {
    headers: config.n8n.sharedSecret ? { "x-clinic-secret": config.n8n.sharedSecret } : {},
  });
}
