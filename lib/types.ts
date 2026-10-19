// Domain types shared by the backend. Money is always integer cents.

export type AgentName = "riley" | "sage" | "ivy" | "pax" | "penny";

export type Severity = "mild" | "moderate" | "severe";

export interface Allergy {
  substance: string; // drug name, generic, or class, e.g. "penicillin"
  severity: Severity;
  reaction?: string;
}

export interface Insurance {
  payer: string;
  member_id: string;
  plan?: string;
}

export interface Patient {
  id: string;
  full_name: string;
  dob: string; // YYYY-MM-DD
  email: string | null;
  phone: string | null;
  allergies: Allergy[];
  insurance: Insurance | null;
  history: string; // approved medical history (only changed after human approval)
  created_at: string;
}

export interface Drug {
  id: string;
  name: string; // brand or common name
  generic: string;
  drug_class: string;
  indication: string; // what it treats, e.g. "bacterial_infection"; used to pick substitutes
  allergens: string[]; // extra substances/classes this drug cross-reacts with
  interacts_with: string[]; // generics/classes with a known interaction
  price_cents: number; // per unit
  stock_qty: number;
}

export const VISIT_STATUSES = [
  "BOOKED",
  "CHECKED_IN",
  "IN_CONSULT",
  "RX_DRAFTED",
  "RX_FLAGGED",
  "RX_PENDING_APPROVAL",
  "RX_APPROVED",
  "DISPENSED",
  "INVOICED",
  "CLOSED",
  "CANCELLED",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export type CoverageStatus = "NOT_STARTED" | "PENDING" | "ACTIVE" | "PARTIAL" | "DENIED" | "ESCALATED";

/** Ivy's coverage decision, used by the invoice math. */
export interface Coverage {
  status: "active" | "partial" | "denied";
  plan: string;
  /** Percent of each line category the insurer pays, 0..100. Missing category = 0. */
  insurer_pays_pct: { visit: number; procedure: number; rx: number };
  /** The patient always pays at least this much (integer cents). */
  copay_cents: number;
  notes: string;
  source: string; // e.g. "payer-data (ivy)" or "no-insurance"
}

// ---------- Payer data (Ivy verifies against these) ----------

export interface InsurancePlan {
  id: string;
  payer: string;
  plan_name: string;
  group_number: string | null;
  coverage_pct_visit: number;
  coverage_pct_procedure: number;
  coverage_pct_rx: number;
  copay_cents: number;
  deductible_cents: number;
  oop_max_cents: number;
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null;
}

export interface InsuranceMember {
  member_id: string;
  plan_id: string;
  full_name: string;
  dob: string;
  status: "active" | "terminated" | "suspended";
  deductible_met_cents: number;
  oop_spent_cents: number;
  annual_visit_limit: number | null; // null = unlimited
  visits_used: number;
}

export type ProviderType = "facility" | "doctor";

export interface NetworkProvider {
  plan_id: string;
  provider_type: ProviderType;
  provider_key: string;
  name: string;
  in_network: boolean;
}

export interface RxItem {
  drug: string; // as written by Dr. Sage; resolved against the formulary
  dose: string;
  frequency: string;
  days: number;
  quantity: number; // units to dispense; derived from frequency × days when Dr. Sage leaves it out
}

export interface Rx {
  items: RxItem[];
  notes: string; // Dr. Sage's reasoning
  summary: string; // Dr. Sage's clinical summary of the visit
  revision: number;
}

export type RxIssueKind = "allergy" | "out_of_stock" | "interaction" | "unknown_drug" | "pharmacist";

export interface RxIssue {
  kind: RxIssueKind;
  drug: string;
  detail: string;
  severity: "warn"; // warnings only: the doctor decides
  alternatives: string[];
}

export interface RxSafetyResult {
  status: "clear" | "flagged";
  issues: RxIssue[];
  source: string; // "code" or "pax"
  explanation?: string; // Pax's plain-language summary
  recommendation?: string;
}

export interface DispensedItem {
  drug_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
}

export interface InvoiceLine {
  code: string;
  description: string;
  category: "visit" | "procedure" | "rx";
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  covered_cents: number;
}

export interface Invoice {
  lines: InvoiceLine[];
  charges_cents: number;
  coverage_cents: number;
  balance_cents: number;
  notes: string[]; // comments on the bill for the patient (e.g. insurance couldn't be verified), from code
  explanation: string; // Penny's words; numbers come from code
}

export interface Visit {
  id: string;
  patient_id: string;
  status: VisitStatus;
  visit_type: string; // e.g. "new_patient", "follow_up"
  reason: string | null;
  slot_start: string | null;
  cal_booking_uid: string | null;
  identity_verified: boolean;
  coverage_status: CoverageStatus;
  coverage: Coverage | null;
  coverage_escalation_reason: string | null; // why Ivy couldn't verify the insurance (coverage_status ESCALATED → not claimed, full bill)
  consult_notes: string | null;
  procedures: string[];
  rx: Rx | null;
  rx_safety: RxSafetyResult | null;
  rx_approved_by: string | null;
  rx_approved_at: string | null;
  history_update: string | null; // proposed by Dr. Sage, pending human approval
  history_update_approved: boolean;
  dispensed: DispensedItem[] | null;
  invoice: Invoice | null;
  created_at: string;
  updated_at: string;
}

export type MessageChannel = "patient_chat" | "band" | "kylon" | "system";

export interface Message {
  id: string;
  visit_id: string | null;
  session_id: string | null;
  channel: MessageChannel;
  sender: string; // agent name, "patient", "doctor", "backend"
  recipient: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  patient_id: string | null;
  visit_id: string | null;
  created_at: string;
}

export interface MemoryNote {
  id: string;
  patient_id: string;
  visit_id: string | null;
  note: string;
  created_at: string;
}
