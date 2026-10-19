/**
 * Visit status machine. The backend is the only thing that moves a visit;
 * every move goes through `transition()` which refuses illegal jumps.
 *
 *   BOOKED → CHECKED_IN → IN_CONSULT → RX_DRAFTED → RX_PENDING_APPROVAL → RX_APPROVED → DISPENSED → INVOICED → CLOSED
 *
 * Pax flags a problem on RX_APPROVED → RX_FLAGGED; the doctor edits and saves again (RX_FLAGGED → RX_APPROVED).
 *
 * A visit with no prescription goes IN_CONSULT → DISPENSED (nothing to dispense) so invoicing is uniform.
 * Coverage runs in parallel on its own field (coverage_status) and never blocks the visit,
 * only the invoice.
 */
import type { Visit, VisitStatus } from "@/lib/types";
import { repo } from "@/lib/db";

const ALLOWED: Record<VisitStatus, VisitStatus[]> = {
  BOOKED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["IN_CONSULT", "CANCELLED"],
  IN_CONSULT: ["RX_DRAFTED", "DISPENSED", "CANCELLED"],
  RX_DRAFTED: ["RX_PENDING_APPROVAL", "CANCELLED"],
  RX_FLAGGED: ["RX_APPROVED", "CANCELLED"],
  RX_PENDING_APPROVAL: ["RX_APPROVED", "CANCELLED"],
  RX_APPROVED: ["DISPENSED", "RX_FLAGGED"],
  DISPENSED: ["INVOICED"],
  INVOICED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return ALLOWED[from].includes(to);
}

export class TransitionError extends Error {
  constructor(public from: VisitStatus, public to: VisitStatus) {
    super(`Illegal visit transition ${from} → ${to}`);
  }
}

/**
 * Move a visit to `to`, optionally patching other fields in the same write.
 * Uses compare-and-set on the current status so two concurrent flows can't both advance it.
 */
export async function transition(visit: Visit, to: VisitStatus, patch: Partial<Visit> = {}): Promise<Visit> {
  if (!canTransition(visit.status, to)) throw new TransitionError(visit.status, to);
  const updated = await repo.updateVisitIfStatus(visit.id, visit.status, { ...patch, status: to });
  if (!updated) {
    const fresh = await repo.getVisit(visit.id);
    throw new TransitionError(fresh?.status ?? visit.status, to);
  }
  await repo.addMessage({
    visit_id: visit.id,
    session_id: null,
    channel: "system",
    sender: "backend",
    recipient: null,
    body: `Visit ${visit.status} → ${to}`,
    payload: { from: visit.status, to },
  });
  return updated;
}
