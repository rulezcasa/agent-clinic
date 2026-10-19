/**
 * INVOICE MATH — always code, never AI.
 *   balance = charges − coverage   (integer cents)
 * Coverage per line = floor(line total × insurer_pays_pct[category] / 100),
 * capped so the patient pays at least the copay.
 */
import type { Coverage, InvoiceLine } from "@/lib/types";

export interface LineInput {
  code: string;
  description: string;
  category: InvoiceLine["category"];
  quantity: number;
  unit_price_cents: number;
}

function assertCents(n: number, what: string) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer (cents), got ${n}`);
}

export function computeInvoice(lines: LineInput[], coverage: Coverage | null) {
  const pct = (cat: InvoiceLine["category"]) => {
    if (!coverage || coverage.status === "denied") return 0;
    const p = coverage.insurer_pays_pct[cat] ?? 0;
    return Math.min(100, Math.max(0, p));
  };

  const priced: InvoiceLine[] = lines.map((l) => {
    assertCents(l.unit_price_cents, `unit price for ${l.code}`);
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error(`quantity for ${l.code} must be a positive integer`);
    const total = l.unit_price_cents * l.quantity;
    const covered = Math.floor((total * pct(l.category)) / 100);
    return { ...l, total_cents: total, covered_cents: covered };
  });

  const charges_cents = priced.reduce((s, l) => s + l.total_cents, 0);
  const copay = coverage && coverage.status !== "denied" ? coverage.copay_cents : 0;
  assertCents(copay, "copay");
  const coverage_cents = Math.min(
    priced.reduce((s, l) => s + l.covered_cents, 0),
    Math.max(0, charges_cents - copay),
  );
  const balance_cents = charges_cents - coverage_cents;
  return { lines: priced, charges_cents, coverage_cents, balance_cents };
}

export const formatCents = (c: number) => `$${(c / 100).toFixed(2)}`;
