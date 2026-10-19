/**
 * AdaL — (1) browser check on the payer portal (runs inside a Celesto session),
 *        (2) writes the post-visit memory note that's recalled next visit.
 */
import { config, need } from "@/lib/config";
import type { Insurance, Patient } from "@/lib/types";
import { startSession } from "./celesto";
import { postJson } from "./http";

/** Raw portal findings. Ivy interprets these into a coverage decision. */
export interface PortalResult {
  eligible: boolean;
  plan: string;
  raw_text: string; // what the portal page said
  details: Record<string, unknown>;
  source: string;
}

export async function checkEligibility(patient: Pick<Patient, "full_name" | "dob">, insurance: Insurance): Promise<PortalResult> {
  const session = await startSession("payer-portal-eligibility");
  const res = await postJson<Partial<PortalResult>>(
    need(config.adal.eligibilityUrl, "ADAL_ELIGIBILITY_URL"),
    { celesto_session_id: session.session_id, patient: { name: patient.full_name, dob: patient.dob }, insurance },
    { apiKey: config.adal.apiKey, timeoutMs: 120_000 },
  );
  return {
    eligible: Boolean(res.eligible),
    plan: res.plan ?? insurance.plan ?? "",
    raw_text: res.raw_text ?? JSON.stringify(res),
    details: res.details ?? {},
    source: `adal:payer-portal (celesto ${session.session_id})`,
  };
}

/** AdaL turns the visit summary into a memory note; the backend stores it in memory_notes. */
export async function writeMemoryNote(input: { patient_id: string; visit_id: string; summary: string }): Promise<string> {
  const res = await postJson<{ note?: string } | string>(need(config.adal.memoryUrl, "ADAL_MEMORY_URL"), input, {
    apiKey: config.adal.apiKey,
  });
  const note = typeof res === "string" ? res : res?.note;
  if (!note) throw new Error("AdaL returned no memory note");
  return note;
}
