/**
 * JSON reply contracts for each agent. The core fields match the output each agent was
 * given in Kylon; extra fields are what the backend needs on top. The backend validates every
 * reply against these before saving anything or moving the visit. Fields are nullable
 * (not optional) so the same schemas work as structured-output formats; replies from Kylon
 * that leave nullable/array fields out are filled in by runAgent before validation.
 *
 * Agents never decide money: the backend recomputes stock, prices
 * and the invoice in code, whatever an agent replies.
 */
import { z } from "zod";

// ---------- Riley — Front Desk ----------

export const RileyReply = z.object({
  reply: z.string().describe("What Riley says to the patient, warm and brief."),
  action: z
    .enum(["none", "book", "verify_identity"])
    .describe("book = patient agreed to a slot and gave name, DOB, email; verify_identity = patient gave name + DOB at check-in."),
  slot: z.string().nullable().describe("ISO start time copied exactly from available_slots when action=book."),
  patient_id: z.string().nullable().describe("Copy known_patient.id when the task has one."),
  identity_verified: z.boolean().nullable().describe("Your read of the match; the backend re-checks against the record."),
  complaint: z.string().nullable().describe("Reason for the visit, in the patient's words."),
  handoff_to: z.array(z.enum(["ivy", "sage"])).describe('["ivy","sage"] once the patient is checked in.'),
  patient: z
    .object({
      full_name: z.string(),
      dob: z.string().describe("YYYY-MM-DD"),
      email: z.string().nullable(),
      insurance_payer: z.string().nullable(),
      insurance_member_id: z.string().nullable(),
    })
    .nullable()
    .describe("Details the patient gave. Required for book and verify_identity."),
  allergies: z
    .array(
      z.object({
        substance: z.string().describe('Drug, generic or class, e.g. "penicillin".'),
        severity: z.enum(["mild", "moderate", "severe"]),
        reaction: z.string().nullable(),
      }),
    )
    .nullable()
    .describe("Check-in only: allergies the patient reported. [] = patient said none; null = not asked yet. Required for verify_identity."),
});
export type RileyReply = z.infer<typeof RileyReply>;

// ---------- Dr. Sage — Doctor Agent ----------

export const SageRxItem = z.object({
  drug: z.string().describe("Drug name exactly as it appears in the formulary."),
  dose: z.string(),
  days: z.number().describe("Treatment length in days."),
  frequency: z.string().describe('e.g. "three times daily".'),
  quantity: z.number().int().nullable().describe("Units to dispense; null lets the backend derive it from frequency × days."),
});

export const SageDraft = z.object({
  rx: z.array(SageRxItem).describe("Empty if no prescription is needed."),
  reasoning: z.string().describe("Why this prescription, tied to what was said in the consult."),
  needs_human_approval: z.boolean().describe("Always true."),
  visit_type: z.enum(["new_patient", "follow_up", "urgent"]).nullable(),
  procedures: z.array(z.string()).describe("Procedure keys from known_procedures that were performed."),
  history_update: z.string().nullable().describe("Proposed addition to the medical history; the human doctor approves it."),
  summary: z.string().nullable().describe("One-paragraph clinical summary of the visit."),
});
export type SageDraft = z.infer<typeof SageDraft>;

export const SageBriefing = z.object({
  briefing: z.string(),
  priorities: z.array(z.string()),
});
export type SageBriefing = z.infer<typeof SageBriefing>;

// ---------- Ivy — Insurance ----------

const Pct = z.number().min(0).max(100);

export const IvyDecision = z.object({
  plan: z.string(),
  coverage_pct: Pct.describe("Percent of the visit the insurer pays."),
  copay_cents: z.number().int().min(0),
  status: z.enum(["covered", "partial", "denied", "needs_review"]).describe("needs_review = escalate to the human doctor; never guess."),
  coverage_by_category: z
    .object({ visit: Pct, procedure: Pct, rx: Pct })
    .nullable()
    .describe("Percent the insurer pays per category, when the portal states it. Null = coverage_pct applies to everything."),
  notes: z.string().nullable(),
});
export type IvyDecision = z.infer<typeof IvyDecision>;

/** Ivy's verification from code-checked plan facts. She posts it on BAND; the money comes from the system. */
export const IvyVerification = IvyDecision.extend({
  hospital_in_network: z.boolean().nullable().describe("Copy facts.hospital_in_network."),
  doctor_in_network: z.boolean().nullable().describe("Copy facts.doctor_in_network."),
  problems: z.array(z.string()).describe("Each reason the insurance is not fully covered or could not be verified."),
  summary: z
    .string()
    .describe("Two or three plain sentences for the other agents: approved or not, network status, coverage left. Quote amounts verbatim; never compute."),
});
export type IvyVerification = z.infer<typeof IvyVerification>;

// ---------- Pax — Pharmacy ----------

export const PaxReview = z.object({
  status: z.enum(["cleared", "flagged"]),
  issues: z.array(z.string()).describe("One clear reason per problem (not on the formulary, not enough stock), for the doctor."),
  dispensed: z
    .array(z.object({ drug: z.string(), qty: z.number(), price_cents: z.number() }))
    .describe("What you dispense when status is cleared; otherwise empty."),
  explanation: z.string().nullable().describe("Plain-language explanation for the doctor."),
  recommendation: z.string().nullable().describe("Concrete fix, using the listed alternatives."),
});
export type PaxReview = z.infer<typeof PaxReview>;

// ---------- Penny — Billing ----------

export const PennyNote = z.object({
  // Display only: the invoice lines and amounts come from code.
  line_items: z.array(z.unknown()).describe("The task's lines, amounts verbatim."),
  explanation: z.string().describe("Short, friendly explanation for the patient. Quote the amounts verbatim; never recompute."),
});
export type PennyNote = z.infer<typeof PennyNote>;
