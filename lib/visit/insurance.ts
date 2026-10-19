/**
 * Ivy — insurance verification. Not customer facing, and asynchronous:
 *
 *   1. Riley gives the patient's insurance (check-in, or POST /api/kiosk/insurance). The details are
 *      saved on the patient, the visit goes to coverage PENDING and the route returns right away.
 *   2. In the background (runCoverage) Ivy checks it: the insurance comes from the patient record, and
 *      code looks up member, plan dates, this clinic's and doctor's network status and what's left of the deductible / out-of-pocket max (lib/rules/insurance.ts).
 *      Ivy gets those plus band_context on Kylon (`check_coverage`), can only make the status stricter.
 *   3. The visit's coverage is saved and Ivy's result goes on BAND as `coverage_result: ivy → penny`
 *      (plus `coverage_escalation: ivy → doctor` when it needs review). Every number comes from code.
 */
import { IvyVerification } from "@/lib/agents/schemas";
import { runAgent } from "@/lib/agents/run";
import { config } from "@/lib/config";
import { repo } from "@/lib/db";
import { HttpError, notFound } from "@/lib/http";
import { normalizeDob, verifyIdentity } from "@/lib/rules/identity";
import { type InsuranceFacts, stricter, type VerificationStatus, verifyInsuranceFacts } from "@/lib/rules/insurance";
import { formatCents } from "@/lib/rules/invoice";
import { publishHandoff } from "@/lib/tools/band";
import type { Coverage, CoverageStatus, Insurance, Patient, Visit } from "@/lib/types";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: config.calcom.timeZone }).format(new Date());
const money = (c: number | null) => (c === null ? null : formatCents(c));

/** Payer + member id are both needed to verify anything; anything less is ignored. */
export function insuranceFrom(i: { insurance_payer?: string | null; insurance_member_id?: string | null; group_number?: string | null }): Insurance | null {
  const payer = i.insurance_payer?.trim();
  const member_id = i.insurance_member_id?.trim().toUpperCase();
  if (!payer || !member_id) return null;
  return { payer, member_id, ...(i.group_number?.trim() ? { group_number: i.group_number.trim() } : {}) };
}

/** Keep the record's insurance up to date with what the patient just told Riley. */
export async function saveInsurance(patient: Patient, insurance: Insurance | null): Promise<Patient> {
  if (!insurance) return patient;
  const same = patient.insurance?.member_id === insurance.member_id && patient.insurance?.payer === insurance.payer;
  if (same && (!insurance.group_number || insurance.group_number === patient.insurance?.group_number)) return patient;
  return repo.updatePatient(patient.id, { insurance: { ...(same && patient.insurance ? patient.insurance : {}), ...insurance } });
}

/**
 * Step 1 (fast, in the request): Riley hands Ivy the patient's insurance for a visit.
 * The caller schedules runInsuranceCheck with after(); the result arrives on BAND.
 */
export async function startInsuranceCheck(input: {
  visit_id: string;
  full_name: string;
  dob: string;
  insurance_payer?: string | null;
  insurance_member_id?: string | null;
  group_number?: string | null;
}) {
  const visit = await repo.getVisit(input.visit_id);
  if (!visit) throw notFound("visit");
  if (["CANCELLED", "INVOICED", "CLOSED"].includes(visit.status)) throw new HttpError(409, `visit is ${visit.status}`);
  const dob = normalizeDob(input.dob);
  if (!dob) throw new HttpError(400, "dob must be YYYY-MM-DD");
  let patient = await repo.getPatient(visit.patient_id);
  if (!patient) throw notFound("patient");
  if (!verifyIdentity(patient, { full_name: input.full_name, dob }).verified) throw new HttpError(403, "name and date of birth do not match the visit");

  const given = insuranceFrom(input);
  if ((input.insurance_payer || input.insurance_member_id) && !given) throw new HttpError(400, "insurance_payer and insurance_member_id are both required");
  patient = await saveInsurance(patient, given);

  // Already being checked with the same details: don't post twice.
  if (visit.coverage_status === "PENDING" && !given) return { accepted: true, visit_id: visit.id, coverage_status: "PENDING" as const, already_running: true };

  await repo.updateVisit(visit.id, { coverage_status: "PENDING" });
  await repo.addMessage({
    visit_id: visit.id,
    session_id: null,
    channel: "system",
    sender: "riley",
    recipient: "ivy",
    body: patient.insurance ? `Verify ${patient.insurance.payer} insurance` : "No insurance given (self-pay)",
    payload: { insurance: patient.insurance as unknown as Record<string, unknown> | null },
  });
  return { accepted: true, visit_id: visit.id, coverage_status: "PENDING" as const, already_running: false };
}

const DECISION: Record<VerificationStatus, "approved" | "rejected" | "needs_review"> = {
  covered: "approved",
  partial: "approved",
  denied: "rejected",
  needs_review: "needs_review",
};
const COVERAGE_STATUS: Record<VerificationStatus, CoverageStatus> = { covered: "ACTIVE", partial: "PARTIAL", denied: "DENIED", needs_review: "ESCALATED" };

async function loadFacts(patient: Patient, insurance: Insurance): Promise<InsuranceFacts> {
  const member = await repo.getInsuranceMember(insurance.member_id);
  const plan = member ? await repo.getInsurancePlan(member.plan_id) : null;
  const [facility, doctor] = plan
    ? await Promise.all([
        repo.getNetworkProvider(plan.id, "facility", config.clinic.facilityId),
        repo.getNetworkProvider(plan.id, "doctor", config.clinic.doctorNpi),
      ])
    : [null, null];
  return verifyInsuranceFacts({
    claimed: { full_name: patient.full_name, dob: patient.dob, payer: insurance.payer, member_id: insurance.member_id, group_number: insurance.group_number },
    member,
    plan,
    facility,
    doctor,
    today: today(),
  });
}

/**
 * Steps 2–3 (background): Ivy verifies, the visit's coverage is saved, and the result goes on BAND.
 * Returns the updated visit. If the check fails, coverage goes back to NOT_STARTED so it can be re-run
 * (POST /api/visits/:id/coverage).
 */
export async function runInsuranceCheck(visitId: string): Promise<Visit> {
  const visit = await repo.getVisit(visitId);
  if (!visit) throw notFound("visit");
  await repo.updateVisit(visit.id, { coverage_status: "PENDING" });
  try {
    return await checkCoverage(visit);
  } catch (err) {
    await repo.updateVisit(visit.id, { coverage_status: "NOT_STARTED" });
    throw err;
  }
}

async function checkCoverage(visit: Visit): Promise<Visit> {
  // Riley's intake hands Ivy the patient id; the insurance itself comes from the record in Supabase.
  const patient = await repo.getPatient(visit.patient_id);
  if (!patient) throw notFound("patient");

  let status: VerificationStatus;
  let facts: InsuranceFacts | null = null;
  let summary: string;
  let notes: string | null = null;
  let problems: string[];

  if (!patient.insurance) {
    // Nothing to verify: self-pay. No agent call needed.
    status = "denied";
    problems = ["no insurance on file"];
    summary = "No insurance on file, so this visit is self-pay.";
  } else {
    facts = await loadFacts(patient, patient.insurance);
    const ivy = await runAgent({
      agent: "ivy",
      kind: "check_coverage",
      instruction:
        "Decide coverage for this visit from the plan facts (checked by the system): " +
        "is it valid, are this clinic and its doctor in network, how much coverage is left. Never compute amounts; quote `amounts` verbatim.",
      data: {
        insurance: patient.insurance,
        facts,
        amounts: {
          copay: money(facts.copay_cents),
          deductible: money(facts.deductible_cents),
          deductible_remaining: money(facts.deductible_remaining_cents),
          out_of_pocket_max: money(facts.oop_max_cents),
          out_of_pocket_remaining: money(facts.oop_remaining_cents),
        },
      },
      schema: IvyVerification,
      visitId: visit.id,
    });
    // Code wins on every fact; Ivy can only escalate.
    status = stricter(facts.status, ivy.status);
    problems = [...new Set([...facts.problems, ...ivy.problems])];
    summary = ivy.summary;
    notes = ivy.notes;
  }

  const coverage: Coverage | null =
    status === "needs_review"
      ? null
      : {
          status: status === "covered" ? "active" : status,
          plan: facts?.plan ?? "self-pay",
          insurer_pays_pct: status === "denied" || !facts?.insurer_pays_pct ? { visit: 0, procedure: 0, rx: 0 } : facts.insurer_pays_pct,
          copay_cents: status === "denied" ? 0 : (facts?.copay_cents ?? 0),
          notes: [summary, ...problems].join(" "),
          source: facts ? "payer-data (ivy)" : "no-insurance",
        };
  const updated = await repo.updateVisit(visit.id, { coverage_status: COVERAGE_STATUS[status], coverage });

  const decision = DECISION[status];
  const result = {
    decision, // approved | rejected | needs_review
    status, // covered | partial | denied | needs_review
    plan: facts?.plan ?? null,
    payer: patient.insurance?.payer ?? null,
    member_id: patient.insurance?.member_id ?? null,
    hospital_in_network: facts?.hospital_in_network ?? null,
    doctor_in_network: facts?.doctor_in_network ?? null,
    insurer_pays_pct: coverage?.insurer_pays_pct ?? null,
    copay_cents: coverage?.copay_cents ?? null,
    balance_coverage: {
      deductible_remaining_cents: facts?.deductible_remaining_cents ?? null,
      deductible_remaining: money(facts?.deductible_remaining_cents ?? null),
      out_of_pocket_remaining_cents: facts?.oop_remaining_cents ?? null,
      out_of_pocket_remaining: money(facts?.oop_remaining_cents ?? null),
      visits_remaining: facts?.visits_remaining ?? null,
    },
    problems,
    summary,
    notes,
  };
  // Penny's invoice task gets this in its band_context.
  await publishHandoff({ from: "ivy", to: ["penny"], visit_id: visit.id, kind: "coverage_result", payload: result });
  if (decision === "needs_review") await publishHandoff({ from: "ivy", to: ["doctor"], visit_id: visit.id, kind: "coverage_escalation", payload: result });
  return updated;
}
