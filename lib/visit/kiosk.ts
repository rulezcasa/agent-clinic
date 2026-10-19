/**
 * Kiosk front end (Riley's in-person voice kiosk, repo: keethz/hackethon-10-19).
 *
 * The kiosk runs its own fast, deterministic conversation (voice via Masky) and calls these
 * functions to act on the clinic's real records. Same rules as the website chat:
 * identity is code, slots come from Cal.com, check-in hands the intake to Ivy + Dr. Sage on BAND.
 * The kiosk adds a second factor (last 4 of the phone on file) when the record has a phone.
 * Insurance goes to Ivy, asynchronously: give it at check-in or via POST /api/kiosk/insurance; Ivy posts
 * `coverage_result: ivy → penny` (approved/rejected + coverage left) on BAND.
 */
import { config } from "@/lib/config";
import { repo } from "@/lib/db";
import { HttpError, notFound } from "@/lib/http";
import { normalizeDob, verifyIdentity } from "@/lib/rules/identity";
import { publishHandoff } from "@/lib/tools/band";
import { createBooking, getFreeSlots } from "@/lib/tools/calcom";
import type { Patient } from "@/lib/types";
import { checkIn } from "./flow";
import { insuranceFrom, startInsuranceCheck } from "./insurance";

const last4 = (phone: string | null) => (phone ?? "").replace(/\D/g, "").slice(-4);

/** ilike treats % and _ as wildcards; the kiosk must only ever match a name exactly. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function findExact(fullName: string, dob: string): Promise<Patient | null> {
  const iso = normalizeDob(dob);
  if (!iso) return null;
  const p = await repo.findPatientByNameDob(escapeLike(fullName), iso);
  return p && verifyIdentity(p, { full_name: fullName, dob: iso }).verified ? p : null;
}

const localDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: config.calcom.timeZone }).format(new Date(iso));

/**
 * Name + DOB must match; if the record has a phone, its last 4 digits must match too.
 * Never says which part failed.
 */
export async function kioskVerify(input: { full_name: string; dob: string; phone_last4?: string | null }) {
  const p = await findExact(input.full_name, input.dob);
  if (!p) return { verified: false as const };
  const onFile = last4(p.phone);
  if (onFile && onFile !== (input.phone_last4 ?? "")) return { verified: false as const };

  const today = localDate(new Date().toISOString());
  const booked = (await repo.listVisits({ patient_id: p.id, status: ["BOOKED"] }))
    .filter((v) => v.slot_start)
    .sort((a, b) => a.slot_start!.localeCompare(b.slot_start!));
  const todays = booked.find((v) => localDate(v.slot_start!) === today) ?? null;
  return {
    verified: true as const,
    second_factor: onFile ? ("phone_last4" as const) : ("none_on_file" as const),
    patient: { id: p.id, first_name: p.full_name.split(" ")[0], has_email: !!p.email, insurance_payer: p.insurance?.payer ?? null },
    todays_visit: todays && { id: todays.id, slot_start: todays.slot_start },
    next_visit: booked[0] ? { id: booked[0].id, slot_start: booked[0].slot_start } : null,
  };
}

/** Check-in through the same code path as the website chat (BAND intake → Ivy + Dr. Sage). */
export async function kioskCheckIn(input: {
  visit_id: string;
  full_name: string;
  dob: string;
  complaint?: string | null;
  insurance_payer?: string | null;
  insurance_member_id?: string | null;
  group_number?: string | null;
}) {
  let visit = await repo.getVisit(input.visit_id);
  if (!visit) throw notFound("visit");
  const dob = normalizeDob(input.dob);
  if (!dob) throw new HttpError(400, "dob must be YYYY-MM-DD");
  if (input.complaint && !visit.reason) visit = await repo.updateVisit(visit.id, { reason: input.complaint.slice(0, 500) });
  const res = await checkIn({ visit, claimed: { full_name: input.full_name, dob }, insurance: insuranceFrom(input) });
  return { verified: res.verified, visit: res.visit && { id: res.visit.id, status: res.visit.status, slot_start: res.visit.slot_start } };
}

/** Book on Cal.com exactly like the chat does; the visit row arrives via Cal.com → n8n → /api/booking. */
export async function kioskBook(input: {
  patient_id?: string | null;
  patient?: { full_name: string; dob: string; email: string; phone?: string | null; insurance_payer?: string | null; insurance_member_id?: string | null } | null;
  slot: string;
  reason?: string | null;
}) {
  const slots = (await getFreeSlots()).map((s) => s.start);
  if (!slots.includes(input.slot)) throw new HttpError(409, "slot_taken");

  let patient: Patient | null = null;
  if (input.patient_id) patient = await repo.getPatient(input.patient_id);
  else if (input.patient) {
    const n = input.patient;
    const dob = normalizeDob(n.dob);
    if (!dob) throw new HttpError(400, "dob must be YYYY-MM-DD");
    // A "new" patient whose name + DOB already exist must verify first (no booking into someone's record).
    if (await findExact(n.full_name, dob)) throw new HttpError(409, "existing_record");
    patient = await repo.createPatient({
      full_name: n.full_name,
      dob,
      email: n.email,
      phone: n.phone ?? null,
      allergies: [],
      insurance: n.insurance_payer && n.insurance_member_id ? { payer: n.insurance_payer, member_id: n.insurance_member_id } : null,
      history: "",
    });
  }
  if (!patient) throw notFound("patient");
  if (!patient.email) throw new HttpError(422, "an email is needed to book");

  const session = await repo.createSession({ patient_id: patient.id });
  const booking = await createBooking({ start: input.slot, name: patient.full_name, email: patient.email, patientId: patient.id, sessionId: session.id, reason: input.reason });
  await repo.addMessage({ visit_id: null, session_id: session.id, channel: "system", sender: "riley", recipient: "backend", body: `Kiosk booking for ${input.slot}`, payload: { source: "kiosk", booking_uid: booking.uid } });
  return { booked: true, booking_uid: booking.uid, slot_start: booking.start, patient_id: patient.id, session_id: session.id };
}

/** Emergency words at the kiosk: tell the human doctor right away. */
export async function kioskAlert(input: { complaint: string; visit_id?: string | null; patient_id?: string | null }) {
  const body = `EMERGENCY at the front-desk kiosk: ${input.complaint.slice(0, 300)}`;
  await repo.addMessage({ visit_id: input.visit_id ?? null, session_id: null, channel: "system", sender: "riley", recipient: "doctor", body, payload: { source: "kiosk", patient_id: input.patient_id ?? null } });
  if (input.visit_id) {
    await publishHandoff({ from: "riley", to: ["doctor"], visit_id: input.visit_id, kind: "emergency", payload: { complaint: input.complaint, source: "kiosk" } });
  }
  return { ok: true };
}

/** Riley hands the insurance to Ivy for a visit; the result goes on BAND as `coverage_result`. */
export async function kioskInsurance(input: Parameters<typeof startInsuranceCheck>[0]) {
  return startInsuranceCheck(input);
}
