/** n8n — the mail room. Outbound: invoice email (rendered in code; n8n only sends it). Inbound calls are checked in lib/http.ts. */
import { config, need } from "@/lib/config";
import type { InvoiceEmail } from "@/lib/rules/invoice-email";
import type { Invoice } from "@/lib/types";
import { postJson } from "./http";

export async function sendInvoiceEmail(payload: { visit_id: string; email: InvoiceEmail; invoice: Invoice }): Promise<void> {
  await postJson(need(config.n8n.invoiceWebhookUrl, "N8N_INVOICE_WEBHOOK_URL"), payload, {
    headers: config.n8n.sharedSecret ? { "x-clinic-secret": config.n8n.sharedSecret } : {},
  });
}
