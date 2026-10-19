/**
 * Insurance verification facts — deterministic. Code looks up the member, plan and network and
 * computes what's left; Ivy only reads these facts and explains them (she never calculates money).
 *
 *   deductible_remaining = max(0, deductible − met)
 *   oop_remaining        = max(0, out-of-pocket max − spent)
 *   visits_remaining     = max(0, annual limit − used)   (null = unlimited)
 *   insurer_pays_pct     = plan % per category; 0 for doctor services when the doctor is out of network,
 *                          0 for the visit when the visit limit is used up, all 0 when denied
 */
import type { InsuranceMember, InsurancePlan, NetworkProvider } from "@/lib/types";
import { sameName } from "./identity";

export type VerificationStatus = "covered" | "partial" | "denied" | "needs_review";

/** The member is matched on member id (the lookup) + full name only. */
export interface ClaimedInsurance {
  full_name: string;
  member_id: string;
}

export interface InsuranceFacts {
  status: VerificationStatus; // what the facts alone say; Ivy can only make it stricter
  member_found: boolean;
  name_match: boolean | null;
  member_status: InsuranceMember["status"] | null;
  plan_in_effect: boolean | null;
  plan: string | null;
  hospital_in_network: boolean | null;
  doctor_in_network: boolean | null;
  coverage_pct: { visit: number; procedure: number; rx: number } | null; // the plan's percentages
  insurer_pays_pct: { visit: number; procedure: number; rx: number } | null; // what applies at this clinic today
  copay_cents: number | null;
  deductible_cents: number | null;
  deductible_remaining_cents: number | null;
  oop_max_cents: number | null;
  oop_remaining_cents: number | null;
  visits_remaining: number | null;
  problems: string[];
}

export const STATUS_RANK: Record<VerificationStatus, number> = { covered: 0, partial: 1, denied: 2, needs_review: 3 };

/** The stricter of two statuses (covered < partial < denied < needs_review). */
export const stricter = (a: VerificationStatus, b: VerificationStatus) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);

export function verifyInsuranceFacts(input: {
  claimed: ClaimedInsurance;
  member: InsuranceMember | null;
  plan: InsurancePlan | null;
  facility: NetworkProvider | null;
  doctor: NetworkProvider | null;
  today: string; // YYYY-MM-DD, clinic time zone
}): InsuranceFacts {
  const { claimed, member, plan, today } = input;
  const problems: string[] = [];
  const empty: InsuranceFacts = {
    status: "needs_review",
    member_found: false,
    name_match: null,
    member_status: null,
    plan_in_effect: null,
    plan: null,
    hospital_in_network: null,
    doctor_in_network: null,
    coverage_pct: null,
    insurer_pays_pct: null,
    copay_cents: null,
    deductible_cents: null,
    deductible_remaining_cents: null,
    oop_max_cents: null,
    oop_remaining_cents: null,
    visits_remaining: null,
    problems,
  };

  // Unknown member: could be a typo or a payer we have no data for. Never guess.
  if (!member || !plan) {
    problems.push(member ? "member's plan is missing from payer data" : "member id not found in payer data");
    return empty;
  }

  const name_match = sameName(member.full_name, claimed.full_name);
  const plan_in_effect = plan.effective_from <= today && (!plan.effective_to || today <= plan.effective_to);
  const hospital_in_network = input.facility?.in_network ?? false;
  const doctor_in_network = input.doctor?.in_network ?? false;
  const visits_remaining = member.annual_visit_limit === null ? null : Math.max(0, member.annual_visit_limit - member.visits_used);

  // Name doesn't match the member: escalate and reveal nothing about someone else's plan.
  if (!name_match) {
    problems.push("name does not match the member on file");
    return { ...empty, member_found: true, name_match };
  }

  // Not eligible here at all → denied. Eligible but something isn't covered → partial.
  let status: VerificationStatus = "covered";
  if (member.status !== "active") problems.push(`membership is ${member.status}`);
  if (!plan_in_effect) problems.push(`plan is not in effect today (${plan.effective_from} to ${plan.effective_to ?? "open"})`);
  if (!hospital_in_network) problems.push("this clinic is out of network for the plan");
  if (problems.length) status = "denied";
  else {
    if (!doctor_in_network) problems.push("the doctor is out of network for the plan");
    if (visits_remaining === 0) problems.push("annual visit limit is used up");
    if (problems.length) status = "partial";
  }

  const coverage_pct = { visit: plan.coverage_pct_visit, procedure: plan.coverage_pct_procedure, rx: plan.coverage_pct_rx };
  const insurer_pays_pct =
    status === "denied"
      ? { visit: 0, procedure: 0, rx: 0 }
      : {
          visit: doctor_in_network && visits_remaining !== 0 ? coverage_pct.visit : 0,
          procedure: doctor_in_network ? coverage_pct.procedure : 0,
          rx: coverage_pct.rx,
        };

  return {
    status,
    member_found: true,
    name_match,
    member_status: member.status,
    plan_in_effect,
    plan: plan.plan_name,
    hospital_in_network,
    doctor_in_network,
    coverage_pct,
    insurer_pays_pct,
    copay_cents: plan.copay_cents,
    deductible_cents: plan.deductible_cents,
    deductible_remaining_cents: Math.max(0, plan.deductible_cents - member.deductible_met_cents),
    oop_max_cents: plan.oop_max_cents,
    oop_remaining_cents: Math.max(0, plan.oop_max_cents - member.oop_spent_cents),
    visits_remaining,
    problems,
  };
}
