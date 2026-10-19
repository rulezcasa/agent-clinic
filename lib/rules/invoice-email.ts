/**
 * The patient's invoice copy — built in code from the final invoice, never by an agent.
 * Notes are the "comments" on the bill (e.g. insurance couldn't be verified), derived from Ivy's coverage result.
 * n8n only delivers the rendered email.
 */
import { formatCents } from "@/lib/rules/invoice";
import type { Invoice, Visit } from "@/lib/types";

/** Patient-facing comments on the bill, from the coverage decision and the totals. */
export function invoiceNotes(visit: Pick<Visit, "coverage_status" | "coverage" | "coverage_escalation_reason">, balance_cents: number): string[] {
  const c = visit.coverage;
  const notes: string[] = [];
  switch (visit.coverage_status) {
    case "ESCALATED":
      notes.push(
        `We couldn't verify your insurance, so it was not claimed for this visit and the full amount is billed to you. Reason: ${visit.coverage_escalation_reason?.replace(/\.\s*$/, "")}. ` +
          "Please contact the front desk with your up-to-date insurance details.",
      );
      break;
    case "DENIED":
      notes.push(
        c?.source === "no-insurance"
          ? "No insurance was on file for this visit, so it is billed as self-pay."
          : `Your insurance${c?.plan ? ` (${c.plan})` : ""} did not cover this visit, so the full amount is billed to you.${c?.notes ? ` ${c.notes}` : ""}`,
      );
      break;
    case "PARTIAL":
      notes.push(`Your insurance${c?.plan ? ` (${c.plan})` : ""} covers part of this visit.${c?.notes ? ` ${c.notes}` : ""}`);
      break;
    case "ACTIVE":
      notes.push(`Your insurance${c?.plan ? ` (${c.plan})` : ""} was applied to this visit.`);
      break;
  }
  if (c && c.status !== "denied" && c.copay_cents > 0) notes.push(`Your plan's copay of ${formatCents(c.copay_cents)} applies.`);
  if (balance_cents === 0) notes.push("Insurance covers this bill in full — there is nothing to pay.");
  return notes;
}

export interface InvoiceEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function invoiceEmail(input: {
  clinic_name: string;
  patient: { name: string; email: string };
  visit: Pick<Visit, "id" | "slot_start" | "created_at">;
  invoice: Invoice;
}): InvoiceEmail {
  const { clinic_name, patient, visit, invoice } = input;
  const number = visit.id.slice(0, 8).toUpperCase();
  const date = (visit.slot_start ?? visit.created_at).slice(0, 10);
  const owed = formatCents(invoice.balance_cents);
  const subject = `${clinic_name} — invoice ${number} (${invoice.balance_cents === 0 ? "nothing to pay" : `${owed} due`})`;

  const text = [
    `${clinic_name} — Invoice ${number}`,
    `Patient: ${patient.name}`,
    `Visit date: ${date}`,
    "",
    ...invoice.lines.map(
      (l) => `${l.description} × ${l.quantity} @ ${formatCents(l.unit_price_cents)} = ${formatCents(l.total_cents)} (insurance covers ${formatCents(l.covered_cents)})`,
    ),
    "",
    `Charges: ${formatCents(invoice.charges_cents)}`,
    `Insurance covers: ${formatCents(invoice.coverage_cents)}`,
    `Amount due: ${owed}`,
    ...(invoice.notes.length ? ["", "Notes:", ...invoice.notes.map((n) => `- ${n}`)] : []),
    "",
    invoice.explanation,
  ].join("\n");

  const row = (cells: string[], bold = false) =>
    `<tr>${cells.map((c, i) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;${i ? "text-align:right;" : ""}${bold ? "font-weight:600;" : ""}">${c}</td>`).join("")}</tr>`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;color:#222">
<h2 style="margin:0 0 4px">${esc(clinic_name)}</h2>
<p style="margin:0 0 16px;color:#555">Invoice ${number} · Visit date ${date}<br>Patient: ${esc(patient.name)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${row(["Item", "Qty", "Unit price", "Total", "Insurance covers"], true)}
${invoice.lines.map((l) => row([esc(l.description), String(l.quantity), formatCents(l.unit_price_cents), formatCents(l.total_cents), formatCents(l.covered_cents)])).join("\n")}
${row(["Charges", "", "", formatCents(invoice.charges_cents), ""])}
${row(["Insurance covers", "", "", "", formatCents(invoice.coverage_cents)])}
${row(["Amount due", "", "", owed, ""], true)}
</table>
${invoice.notes.length ? `<h3 style="margin:20px 0 6px;font-size:15px">Notes</h3><ul style="margin:0;padding-left:20px">${invoice.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<p style="margin-top:20px;white-space:pre-line">${esc(invoice.explanation)}</p>
</div>`;

  return { to: patient.email, subject, text, html };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
