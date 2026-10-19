/**
 * The visit, step by step (see tools.md). The backend is the only controller: it gives each
 * agent just the data its task needs, validates the JSON reply, and moves the visit.
 *
 * Two things are always code, never AI: the severe allergy block and the invoice math.
 */
import { PaxReview, PennyNote, RileyReply, SageBriefing, SageDraft } from "@/lib/agents/schemas";
import { runAgent } from "@/lib/agents/run";
import { config } from "@/lib/config";
import { repo } from "@/lib/db";
import { HttpError, notFound } from "@/lib/http";
import { severeAllergyBlock } from "@/lib/rules/allergy";
import { findDrug } from "@/lib/rules/formulary";
import { verifyIdentity } from "@/lib/rules/identity";
import { computeInvoice, formatCents } from "@/lib/rules/invoice";
import { deriveQuantity } from "@/lib/rules/quantity";
import { writeMemoryNote } from "@/lib/tools/adal";
import { publishHandoff } from "@/lib/tools/band";
import { createBooking, getFreeSlots } from "@/lib/tools/calcom";
import { speak } from "@/lib/tools/masky";
import { billingLines } from "@/lib/tools/finch";
import { sendInvoiceEmail } from "@/lib/tools/n8n";
import { compressContext } from "@/lib/tools/paritok";
import { runRxSafety } from "@/lib/tools/rocketride";
import type { Coverage, CoverageStatus, DispensedItem, Drug, Insurance, Patient, RxIssue, RxItem, Visit } from "@/lib/types";
import { insuranceFrom, runInsuranceCheck, saveInsurance } from "./insurance";
import { transition } from "./status";

/** How many times Dr. Sage revises on its own after a flag before the human doctor steps in. */
const AUTO_REVISIONS = 2;

async function loadVisit(id: string): Promise<Visit> {
  const v = await repo.getVisit(id);
  if (!v) throw notFound("visit");
  return v;
}

async function loadPatient(id: string): Promise<Patient> {
  const p = await repo.getPatient(id);
  if (!p) throw notFound("patient");
  return p;
}

// ---------- 1–4. Patient chat with Riley: booking and check-in ----------

/** Which front-desk tab the patient is talking to Riley from. */
export type Desk = "booking" | "checkin";

const DESK_INSTRUCTION: Record<Desk, string> = {
  booking: "Reply to the patient on the clinic website. They want to book an appointment.",
  checkin:
    "Reply to the patient at the clinic's check-in desk. They are here for a booked appointment: ask for their full name and date of birth, then use action verify_identity.",
};

export async function chatTurn(input: { session_id?: string; message: string; desk: Desk }) {
  const session = input.session_id ? await repo.getSession(input.session_id) : await repo.createSession();
  if (!session) throw notFound("chat session");

  const visit = session.visit_id ? await repo.getVisit(session.visit_id) : null;
  const patient = session.patient_id ? await repo.getPatient(session.patient_id) : null;
  // Riley's memory of this chat: the last 30 patient/Riley lines (filter first — the session also holds Kylon task logs).
  const history = (await repo.listMessages({ session_id: session.id })).filter((m) => m.channel === "patient_chat").slice(-30);
  // Check-in never books, so Riley only sees open slots on the booking desk.
  const slots = visit || input.desk === "checkin" ? [] : (await getFreeSlots()).map((s) => s.start);

  await repo.addMessage({ visit_id: visit?.id ?? null, session_id: session.id, channel: "patient_chat", sender: "patient", recipient: "riley", body: input.message, payload: null });

  const riley = await runAgent({
    agent: "riley",
    kind: input.desk === "checkin" ? "checkin" : "chat",
    instruction: DESK_INSTRUCTION[input.desk],
    data: {
      desk: input.desk,
      visit: visit && { id: visit.id, status: visit.status, slot_start: visit.slot_start },
      known_patient: patient && { id: patient.id, full_name: patient.full_name },
      available_slots: slots,
      time_zone: config.calcom.timeZone,
      conversation: history.map((m) => ({ from: m.sender === "patient" ? "patient" : "riley", text: m.body })),
      latest_message: input.message,
    },
    schema: RileyReply,
    sessionId: session.id,
    visitId: visit?.id,
  });

  let reply = riley.reply;
  let current = visit;
  let checkedIn = false;

  if (riley.action === "book") {
    await bookFromChat(session.id, riley, slots);
  } else if (riley.action === "verify_identity") {
    if (!riley.patient) throw new Error("Riley asked to verify identity without name + DOB");
    const res = await checkIn({ visit, claimed: riley.patient, insurance: insuranceFrom(riley.patient), sessionId: session.id });
    current = res.visit;
    checkedIn = res.verified;
    // Code decides identity, so the patient hears the code's answer.
    if (!res.verified) reply = "Sorry, those details don't match an appointment we have. Could you check your full name and date of birth?";
  }

  // Riley's Masky voice says the reply; the chat page plays audio_url.
  const audioUrl = await speak("riley", reply);

  await repo.addMessage({ visit_id: current?.id ?? null, session_id: session.id, channel: "patient_chat", sender: "riley", recipient: "patient", body: reply, payload: { action: riley.action, audio_url: audioUrl } });
  return { session_id: session.id, reply, audio_url: audioUrl, action: riley.action, visit: current, checked_in: checkedIn };
}

/** Step 2: Riley picked a slot with the patient; the backend books it on Cal.com. */
async function bookFromChat(sessionId: string, riley: RileyReply, slots: string[]) {
  const p = riley.patient;
  if (!riley.slot || !slots.includes(riley.slot)) throw new Error(`Riley picked a slot that is not available: ${riley.slot}`);
  if (!p?.full_name || !p.dob || !p.email) throw new Error("Riley asked to book without name, DOB and email");

  const patient =
    (await repo.findPatientByNameDob(p.full_name, p.dob)) ??
    (await repo.createPatient({
      full_name: p.full_name,
      dob: p.dob,
      email: p.email,
      phone: null,
      allergies: [],
      insurance: p.insurance_payer && p.insurance_member_id ? { payer: p.insurance_payer, member_id: p.insurance_member_id } : null,
      history: "",
    }));
  await repo.updateSession(sessionId, { patient_id: patient.id });
  // Cal.com fires BOOKING_CREATED → n8n → POST /api/booking, which creates the visit.
  await createBooking({ start: riley.slot, name: patient.full_name, email: p.email, patientId: patient.id, sessionId, reason: riley.complaint });
}

/** Step 3: Cal.com booking (via n8n) → visit. Idempotent on the booking uid. */
export async function createVisitFromBooking(b: { uid: string; start: string; patient_id: string; session_id?: string | null; reason?: string | null }) {
  const existing = await repo.getVisitByBookingUid(b.uid);
  if (existing) return existing;
  await loadPatient(b.patient_id);
  const prior = await repo.listVisits({ patient_id: b.patient_id, status: ["CLOSED"] });
  const visit = await repo.createVisit({
    patient_id: b.patient_id,
    visit_type: prior.length ? "follow_up" : "new_patient",
    reason: b.reason ?? null,
    slot_start: b.start,
    cal_booking_uid: b.uid,
  });
  if (b.session_id) await repo.updateSession(b.session_id, { visit_id: visit.id, patient_id: b.patient_id });
  return visit;
}

/**
 * Step 4–5: identity check (code), then the intake packet goes to Ivy and Dr. Sage on BAND.
 * Insurance Riley collected is saved on the patient first; Ivy pulls it from Supabase by patient id (runCoverage).
 */
export async function checkIn(input: { visit: Visit | null; claimed: { full_name: string; dob: string }; insurance?: Insurance | null; sessionId?: string }) {
  let visit = input.visit;
  if (!visit) {
    // Patient arrived in a new chat: find their booked visit by name + DOB.
    const p = await repo.findPatientByNameDob(input.claimed.full_name, input.claimed.dob);
    visit = p ? ((await repo.listVisits({ patient_id: p.id, status: ["BOOKED"] }))[0] ?? null) : null;
    if (!visit) return { verified: false, visit: null };
  }
  let patient = await loadPatient(visit.patient_id);
  if (visit.status !== "BOOKED" || !verifyIdentity(patient, input.claimed).verified) return { verified: false, visit };
  patient = await saveInsurance(patient, input.insurance ?? null);

  visit = await transition(visit, "CHECKED_IN", { identity_verified: true });
  if (input.sessionId) await repo.updateSession(input.sessionId, { visit_id: visit.id, patient_id: patient.id });
  await publishHandoff({
    from: "riley",
    to: ["ivy", "sage"],
    visit_id: visit.id,
    kind: "intake",
    payload: { patient_id: patient.id, identity_verified: true, complaint: visit.reason, slot_start: visit.slot_start },
  });
  return { verified: true, visit };
}

// ---------- 6. Coverage (runs in the background after check-in) ----------

/**
 * Ivy checks coverage against the payer data in Supabase and posts `coverage_result: ivy → penny` on BAND (lib/visit/insurance.ts).
 * Once coverage is decided, the invoice can go out if the visit is already dispensed.
 */
export async function runCoverage(visitId: string) {
  const visit = await runInsuranceCheck(visitId);
  return visit.coverage_status === "ESCALATED" ? visit : tryInvoice(visit.id);
}

/** The human doctor resolves an escalated (ambiguous) coverage. */
export async function overrideCoverage(visitId: string, c: Omit<Coverage, "source">) {
  return saveCoverage(visitId, { ...c, source: "doctor-override" }, "doctor");
}

async function saveCoverage(visitId: string, coverage: Coverage, from: "ivy" | "doctor") {
  const status: CoverageStatus = coverage.status === "active" ? "ACTIVE" : coverage.status === "partial" ? "PARTIAL" : "DENIED";
  await repo.updateVisit(visitId, { coverage_status: status, coverage });
  await publishHandoff({ from: from === "ivy" ? "ivy" : "backend", to: ["penny"], visit_id: visitId, kind: "coverage_result", payload: { ...coverage } });
  return tryInvoice(visitId);
}

// ---------- 7–9. Consult → Dr. Sage drafts → RocketRide + allergy check → human approval → Pax ----------

interface Revision {
  previous_rx: RxItem[];
  issues: RxIssue[];
  pharmacist_note: string | null;
  doctor_feedback: string | null;
}

/** The human doctor saves consult notes; Dr. Sage drafts and the safety check runs. */
export async function startConsult(visitId: string, notes: string) {
  const visit = await transition(await loadVisit(visitId), "IN_CONSULT", { consult_notes: notes });
  return draftAndCheck(visit, null, AUTO_REVISIONS);
}

async function draftAndCheck(visit: Visit, revision: Revision | null, autoLeft: number): Promise<Visit> {
  const patient = await loadPatient(visit.patient_id);
  const [formulary, notes] = await Promise.all([repo.listDrugs(), repo.listMemoryNotes(patient.id)]);
  const history = await compressContext([patient.history, ...notes.map((n) => n.note)].filter(Boolean).join("\n"));

  const sage = await runAgent({
    agent: "sage",
    kind: revision ? "revise_rx" : "draft_rx",
    instruction: revision ? "Revise the prescription to resolve every issue and explain the change." : "Review the intake and draft a prescription.",
    data: {
      intake: { complaint: visit.reason, consult_notes: visit.consult_notes },
      compressed_history: history,
      allergies: patient.allergies.map(({ substance, severity }) => ({ substance, severity })),
      formulary: formulary.map((d) => ({ name: d.name, generic: d.generic, drug_class: d.drug_class, indication: d.indication })), // stock is Pax's job
      visit_type: visit.visit_type,
      revision,
    },
    schema: SageDraft,
    visitId: visit.id,
  });

  const fields: Partial<Visit> = {
    procedures: sage.procedures,
    visit_type: sage.visit_type ?? visit.visit_type,
    history_update: sage.history_update,
  };

  // No prescription: nothing to approve or dispense.
  if (!sage.rx.length && visit.status === "IN_CONSULT") {
    visit = await transition(visit, "DISPENSED", { ...fields, dispensed: [] });
    return tryInvoice(visit.id);
  }

  const items: RxItem[] = sage.rx.map((i) => ({ drug: i.drug, dose: i.dose, frequency: i.frequency, days: i.days, quantity: deriveQuantity(i) }));
  visit = await transition(visit, "RX_DRAFTED", {
    ...fields,
    rx: { items, notes: sage.reasoning, summary: sage.summary ?? "", revision: (visit.rx?.revision ?? -1) + 1 },
    rx_safety: null,
    rx_approved_by: null,
    rx_approved_at: null,
  });
  return checkRx(visit, patient, formulary, autoLeft);
}

/** Before approval: RocketRide rx-safety + the code severe-allergy block. Stock is checked by Pax after approval. */
async function checkRx(visit: Visit, patient: Patient, formulary: Drug[], autoLeft: number): Promise<Visit> {
  const items = visit.rx!.items;
  const safety = await runRxSafety({ allergies: patient.allergies, formulary, items });
  const issues = [...safety.issues, ...allergyBackstop(patient, items, formulary, safety.issues)];
  const blocked = issues.some((i) => i.severity === "block");
  const rx_safety = { status: blocked ? ("blocked" as const) : issues.length ? ("flagged" as const) : ("clear" as const), issues, source: safety.source };

  if (!blocked) {
    visit = await transition(visit, "RX_PENDING_APPROVAL", { rx_safety });
    await publishHandoff({ from: "sage", to: ["doctor"], visit_id: visit.id, kind: "rx_approval_request", payload: { rx: items, rx_safety } });
    return visit;
  }

  visit = await transition(visit, "RX_FLAGGED", { rx_safety });
  await publishHandoff({ from: "backend", to: ["sage"], visit_id: visit.id, kind: "rx_flag", payload: { ...rx_safety } });
  if (autoLeft <= 0) return visit; // the human doctor decides next (reject with feedback → Dr. Sage redrafts)
  return draftAndCheck(visit, { previous_rx: items, issues, pharmacist_note: null, doctor_feedback: null }, autoLeft - 1);
}

/** SEVERE ALLERGY BLOCK (code): add any severe-allergy hit the pipeline missed. */
function allergyBackstop(patient: Patient, items: RxItem[], formulary: Drug[], found: RxIssue[]): RxIssue[] {
  return severeAllergyBlock(patient.allergies, items, formulary)
    .hits.filter((h) => !found.some((i) => i.kind === "allergy" && i.drug === h.drug && i.severity === "block"))
    .map((h) => ({ kind: "allergy", drug: h.drug, detail: `Patient has a severe allergy to ${h.allergy}.`, severity: "block", alternatives: [] }));
}

/** Step 9: the human doctor approves → Pax dispenses. */
export async function approveRx(visitId: string, approvedBy: string) {
  let visit = await loadVisit(visitId);
  if (visit.status !== "RX_PENDING_APPROVAL") throw new HttpError(409, `visit is ${visit.status}, not RX_PENDING_APPROVAL`);
  const patient = await loadPatient(visit.patient_id);
  const formulary = await repo.listDrugs();
  const items = visit.rx!.items;
  if (severeAllergyBlock(patient.allergies, items, formulary).blocked) throw new HttpError(409, "severe allergy: this prescription cannot be approved");

  visit = await transition(visit, "RX_APPROVED", { rx_approved_by: approvedBy, rx_approved_at: new Date().toISOString() });

  const pax = await runAgent({
    agent: "pax",
    kind: "dispense",
    instruction: "The doctor approved this prescription. Check stock and dispense, or flag problems back to Dr. Sage.",
    data: { rx: items, issues: visit.rx_safety?.issues ?? [], formulary: formulary.map(({ name, price_cents, stock_qty }) => ({ name, price_cents, stock_qty })) },
    schema: PaxReview,
    visitId: visit.id,
  });

  if (pax.status === "flagged") {
    const issues = pax.issues.map((detail): RxIssue => ({ kind: "pharmacist", drug: "", detail, severity: "block", alternatives: [] }));
    visit = await transition(visit, "RX_FLAGGED", { rx_safety: { status: "flagged", issues, source: "pax", explanation: pax.explanation ?? undefined } });
    await publishHandoff({ from: "pax", to: ["sage"], visit_id: visit.id, kind: "rx_flag", payload: { issues } });
    return draftAndCheck(visit, { previous_rx: items, issues, pharmacist_note: pax.explanation, doctor_feedback: null }, AUTO_REVISIONS);
  }

  // Stock and prices are code: take stock from the formulary, never from Pax's numbers.
  const dispensed: DispensedItem[] = [];
  for (const item of items) {
    const drug = findDrug(formulary, item.drug);
    if (!drug) throw new Error(`${item.drug} is not on the formulary`);
    if (!(await repo.takeStock(drug.id, item.quantity))) throw new Error(`not enough ${drug.name} in stock`);
    dispensed.push({ drug_id: drug.id, name: drug.name, quantity: item.quantity, unit_price_cents: drug.price_cents });
  }
  visit = await transition(visit, "DISPENSED", { dispensed });
  await publishHandoff({ from: "pax", to: ["penny"], visit_id: visit.id, kind: "dispensed", payload: { dispensed } });
  return tryInvoice(visit.id);
}

/** The human doctor sends the Rx back to Dr. Sage with feedback. */
export async function rejectRx(visitId: string, feedback: string) {
  const visit = await loadVisit(visitId);
  if (visit.status !== "RX_PENDING_APPROVAL" && visit.status !== "RX_FLAGGED") throw new HttpError(409, `visit is ${visit.status}`);
  return draftAndCheck(
    visit,
    { previous_rx: visit.rx?.items ?? [], issues: visit.rx_safety?.issues ?? [], pharmacist_note: visit.rx_safety?.explanation ?? null, doctor_feedback: feedback },
    AUTO_REVISIONS,
  );
}

// ---------- 10–12. Invoice → email → memory note → closed ----------

/** Runs once the visit is DISPENSED and coverage is decided (whichever finishes last calls it). */
async function tryInvoice(visitId: string): Promise<Visit> {
  let visit = await loadVisit(visitId);
  if (visit.status !== "DISPENSED" || !["ACTIVE", "PARTIAL", "DENIED"].includes(visit.coverage_status)) return visit;
  const patient = await loadPatient(visit.patient_id);

  const lines = await billingLines({ visit_type: visit.visit_type, procedures: visit.procedures, dispensed: visit.dispensed ?? [] });
  const math = computeInvoice(lines, visit.coverage);
  const penny = await runAgent({
    agent: "penny",
    kind: "invoice",
    instruction: "Write the invoice explanation for the patient. The amounts are final.",
    data: {
      patient_name: patient.full_name,
      lines: math.lines.map((l) => ({ description: l.description, total: formatCents(l.total_cents), covered: formatCents(l.covered_cents) })),
      charges: formatCents(math.charges_cents),
      coverage: formatCents(math.coverage_cents),
      balance: formatCents(math.balance_cents),
      coverage_status: visit.coverage_status,
    },
    schema: PennyNote,
    visitId: visit.id,
  });

  const invoice = { ...math, explanation: penny.explanation };
  visit = await transition(visit, "INVOICED", { invoice });
  await sendInvoiceEmail({ visit_id: visit.id, patient: { name: patient.full_name, email: patient.email }, invoice });

  const note = await writeMemoryNote({ patient_id: patient.id, visit_id: visit.id, summary: visitSummary(visit) });
  await repo.addMemoryNote({ patient_id: patient.id, visit_id: visit.id, note });
  return transition(visit, "CLOSED");
}

function visitSummary(v: Visit): string {
  const flags = v.rx_safety?.issues.filter((i) => i.severity === "block").map((i) => `${i.drug}: ${i.detail}`) ?? [];
  return [
    `Visit ${v.slot_start?.slice(0, 10) ?? ""} (${v.visit_type}). Reason: ${v.reason ?? "n/a"}.`,
    v.rx?.summary && `Summary: ${v.rx.summary}`,
    v.dispensed?.length ? `Dispensed: ${v.dispensed.map((d) => `${d.name} x${d.quantity}`).join(", ")}.` : "No prescription.",
    flags.length && `Flags during the visit: ${flags.join("; ")}.`,
    `Coverage: ${v.coverage_status}${v.coverage?.plan ? ` (${v.coverage.plan})` : ""}. Balance: ${formatCents(v.invoice?.balance_cents ?? 0)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The human doctor approves Dr. Sage's proposed history update. */
export async function approveHistory(visitId: string) {
  const visit = await loadVisit(visitId);
  if (!visit.history_update || visit.history_update_approved) throw new HttpError(409, "no pending history update");
  const patient = await loadPatient(visit.patient_id);
  await repo.updatePatient(patient.id, { history: [patient.history, visit.history_update].filter(Boolean).join("\n") });
  return repo.updateVisit(visit.id, { history_update_approved: true });
}

// ---------- Daily briefing (n8n 6pm schedule) ----------

export async function dailyBriefing() {
  const today = new Date().toISOString().slice(0, 10);
  const visits = (await repo.listVisits()).filter((v) => v.created_at.startsWith(today) || v.slot_start?.startsWith(today));
  const waiting = await waitingForDoctor();
  return runAgent({
    agent: "sage",
    kind: "briefing",
    instruction: "Write the doctor's end-of-day briefing and list what needs their attention.",
    data: { date: today, visits: visits.map((v) => ({ status: v.status, coverage_status: v.coverage_status, reason: v.reason })), waiting_for_doctor: waiting },
    schema: SageBriefing,
  });
}

/** Everything blocked on the human doctor. */
export async function waitingForDoctor() {
  const visits = await repo.listVisits();
  return visits.flatMap((v) => [
    ...(v.status === "RX_PENDING_APPROVAL" ? [{ visit_id: v.id, item: "approve prescription" }] : []),
    ...(v.status === "RX_FLAGGED" ? [{ visit_id: v.id, item: "prescription still flagged after revisions" }] : []),
    ...(v.coverage_status === "ESCALATED" ? [{ visit_id: v.id, item: "resolve ambiguous coverage" }] : []),
    ...(v.history_update && !v.history_update_approved && v.status !== "CANCELLED" ? [{ visit_id: v.id, item: "approve history update" }] : []),
  ]);
}
