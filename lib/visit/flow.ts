/**
 * The visit, step by step (see tools.md). The backend is the only controller: it gives each
 * agent just the data its task needs, validates the JSON reply, and moves the visit.
 *
 * Always code, never AI: stock and prices, and the invoice math.
 */
import { PaxReview, PennyNote, RileyReply, SageBriefing, SageDraft } from "@/lib/agents/schemas";
import { runAgent } from "@/lib/agents/run";
import { config } from "@/lib/config";
import { repo } from "@/lib/db";
import { HttpError, notFound } from "@/lib/http";
import { findDrug } from "@/lib/rules/formulary";
import { verifyIdentity } from "@/lib/rules/identity";
import { billingLines, computeInvoice, formatCents } from "@/lib/rules/invoice";
import { invoiceEmail, invoiceNotes } from "@/lib/rules/invoice-email";
import { deriveQuantity } from "@/lib/rules/quantity";
import { publishHandoff } from "@/lib/tools/band";
import { createBooking, getFreeSlots } from "@/lib/tools/calcom";
import { speak } from "@/lib/tools/masky";
import { sendInvoiceEmail } from "@/lib/tools/n8n";
import { compressContext } from "@/lib/tools/paritok";
import type { Allergy, DispensedItem, Insurance, Patient, RxIssue, RxItem, Visit } from "@/lib/types";
import { insuranceFrom, runInsuranceCheck, saveInsurance } from "./insurance";
import { transition } from "./status";

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
  booking: "Reply to the patient on the clinic website. They want to book an appointment. Don't ask about insurance; that's taken at check-in.",
  checkin:
    "Reply to the patient at the clinic's check-in desk. They are here for a booked appointment: ask for their full name and date of birth, and whether they have any allergies (what to, the reaction, and how severe), and their insurance (company and member id; or that they're paying themselves). Once you have all of it, use action verify_identity with the allergies ([] if none) and the insurance (leave it null for self-pay).",
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
    if (!riley.allergies) throw new Error("Riley asked to verify identity without asking about allergies");
    const allergies = riley.allergies.map(({ reaction, ...a }) => ({ ...a, ...(reaction ? { reaction } : {}) }));
    const res = await checkIn({ visit, claimed: riley.patient, insurance: insuranceFrom(riley.patient), allergies, sessionId: session.id });
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
      insurance: null, // taken at check-in
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

/** Reported allergies win over recorded ones for the same substance; "none" never erases the record. */
function mergeAllergies(recorded: Allergy[], reported: Allergy[]): Allergy[] {
  const key = (a: Allergy) => a.substance.trim().toLowerCase();
  const reportedKeys = new Set(reported.map(key));
  return [...recorded.filter((a) => !reportedKeys.has(key(a))), ...reported];
}

/**
 * Step 4–5: identity check (code), then the intake packet goes to Ivy and Dr. Sage on BAND.
 * Insurance Riley collected is saved on the patient first; Ivy pulls it from Supabase by patient id (runCoverage).
 */
export async function checkIn(input: {
  visit: Visit | null;
  claimed: { full_name: string; dob: string };
  insurance?: Insurance | null;
  allergies?: Allergy[];
  sessionId?: string;
}) {
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

  // Only after identity matches, so a wrong name + DOB never writes to someone's record.
  if (input.allergies?.length) patient = await repo.updatePatient(patient.id, { allergies: mergeAllergies(patient.allergies, input.allergies) });
  visit = await transition(visit, "CHECKED_IN", { identity_verified: true });
  if (input.sessionId) await repo.updateSession(input.sessionId, { visit_id: visit.id, patient_id: patient.id });
  await publishHandoff({
    from: "riley",
    to: ["ivy", "sage"],
    visit_id: visit.id,
    kind: "intake",
    payload: { patient_id: patient.id, identity_verified: true, complaint: visit.reason, slot_start: visit.slot_start, allergies: patient.allergies },
  });
  return { verified: true, visit };
}

// ---------- 6. Coverage (runs in the background after check-in) ----------

/**
 * Ivy checks coverage against the payer data in Supabase and posts `coverage_result: ivy → penny` on BAND (lib/visit/insurance.ts).
 * Once coverage is decided (escalated = not claimed, full bill), the invoice can go out if the visit is already dispensed.
 */
export async function runCoverage(visitId: string) {
  const visit = await runInsuranceCheck(visitId);
  return tryInvoice(visit.id);
}

// ---------- 7–9. Consult → Dr. Sage drafts → doctor edits and saves (= approves) → Pax ----------

/**
 * The doctor clicks "Generate prescription": Dr. Sage drafts once from the consult transcript it listened to.
 * The transcript itself isn't stored; Dr. Sage's summary becomes the consult notes. IN_CONSULT again = retry a draft that failed.
 */
export async function startConsult(visitId: string, transcript: string) {
  const current = await loadVisit(visitId);
  let visit = current.status === "IN_CONSULT" ? current : await transition(current, "IN_CONSULT");
  const patient = await loadPatient(visit.patient_id);
  const [formulary, notes] = await Promise.all([repo.listDrugs(), repo.listMemoryNotes(patient.id)]);
  const history = await compressContext([patient.history, ...notes.map((n) => n.note)].filter(Boolean).join("\n"));

  const sage = await runAgent({
    agent: "sage",
    kind: "draft_rx",
    instruction:
      "You listened to this consult between the human doctor and the patient. consult_transcript is the raw speech-to-text, with no speaker labels: work out who is the doctor and who is the patient, then draft the prescription the doctor decided on.",
    data: {
      intake: { complaint: visit.reason, consult_transcript: transcript },
      compressed_history: history,
      allergies: patient.allergies.map(({ substance, severity }) => ({ substance, severity })),
      formulary: formulary.map((d) => ({ name: d.name, generic: d.generic, drug_class: d.drug_class, indication: d.indication })), // stock is Pax's job
      visit_type: visit.visit_type,
    },
    schema: SageDraft,
    visitId: visit.id,
  });

  const fields: Partial<Visit> = {
    consult_notes: sage.summary,
    procedures: sage.procedures,
    visit_type: sage.visit_type ?? visit.visit_type,
    history_update: sage.history_update,
  };

  // No prescription: nothing to approve or dispense.
  if (!sage.rx.length) {
    visit = await transition(visit, "DISPENSED", { ...fields, dispensed: [] });
    return tryInvoice(visit.id);
  }

  const items: RxItem[] = sage.rx.map((i) => ({ drug: i.drug, dose: i.dose, frequency: i.frequency, days: i.days, quantity: deriveQuantity(i) }));
  visit = await transition(visit, "RX_DRAFTED", { ...fields, rx: { items, notes: sage.reasoning, summary: sage.summary ?? "", revision: 0 } });
  // The doctor sees it with the patient's allergies listed for reference, edits if needed, and saves.
  visit = await transition(visit, "RX_PENDING_APPROVAL", { rx_safety: null });
  await publishHandoff({ from: "sage", to: ["doctor"], visit_id: visit.id, kind: "rx_approval_request", payload: { rx: items } });
  return visit;
}

export type EditedRxItem = Omit<RxItem, "quantity"> & { quantity: number | null };

/**
 * Step 9: the doctor saves the prescription as edited — saving is the approval → handoff to Pax on BAND
 * → Pax checks formulary + stock and dispenses.
 */
export async function approveRx(visitId: string, approvedBy: string, edited: EditedRxItem[]) {
  let visit = await loadVisit(visitId);
  if (visit.status !== "RX_PENDING_APPROVAL" && visit.status !== "RX_FLAGGED") throw new HttpError(409, `visit is ${visit.status}`);
  const formulary = await repo.listDrugs();
  const items: RxItem[] = edited.map((i) => ({ ...i, quantity: deriveQuantity(i) }));

  visit = await transition(visit, "RX_APPROVED", {
    rx: { items, notes: visit.rx?.notes ?? "", summary: visit.rx?.summary ?? "", revision: (visit.rx?.revision ?? 0) + 1 },
    rx_approved_by: approvedBy,
    rx_approved_at: new Date().toISOString(),
  });
  await publishHandoff({
    from: "doctor",
    to: ["pax"],
    visit_id: visit.id,
    kind: "rx_approved",
    payload: { rx: items, approved_by: approvedBy, summary: visit.rx?.summary ?? "" },
  });

  const pax = await runAgent({
    agent: "pax",
    kind: "dispense",
    instruction:
      "The doctor approved this prescription. Check every drug is on the formulary and has enough stock for the quantity. If so, dispense. If not, flag each problem for the doctor with alternatives from the formulary.",
    data: {
      rx: items,
      formulary: formulary.map(({ name, generic, indication, price_cents, stock_qty }) => ({ name, generic, indication, price_cents, stock_qty })),
    },
    schema: PaxReview,
    visitId: visit.id,
  });

  // Stock and prices are code: Pax's "cleared" still has to hold against the formulary.
  const resolved = items.map((item) => ({ item, drug: findDrug(formulary, item.drug) }));
  const missed = resolved.flatMap(({ item, drug }) =>
    !drug ? [`${item.drug} is not on the formulary.`] : drug.stock_qty < item.quantity ? [`Only ${drug.stock_qty} ${drug.name} in stock, ${item.quantity} needed.`] : [],
  );
  const problems = pax.status === "flagged" ? pax.issues : missed;

  if (problems.length) {
    const issues = problems.map((detail): RxIssue => ({ kind: "pharmacist", drug: "", detail, severity: "warn", alternatives: [] }));
    visit = await transition(visit, "RX_FLAGGED", {
      rx_safety: { status: "flagged", issues, source: "pax", explanation: pax.explanation ?? undefined, recommendation: pax.recommendation ?? undefined },
    });
    await publishHandoff({ from: "pax", to: ["doctor"], visit_id: visit.id, kind: "rx_flag", payload: { issues, recommendation: pax.recommendation } });
    return visit; // the doctor edits and saves again
  }

  const dispensed: DispensedItem[] = [];
  for (const { item, drug } of resolved) {
    if (!(await repo.takeStock(drug!.id, item.quantity))) throw new Error(`not enough ${drug!.name} in stock`);
    dispensed.push({ drug_id: drug!.id, name: drug!.name, quantity: item.quantity, unit_price_cents: drug!.price_cents });
  }
  visit = await transition(visit, "DISPENSED", { dispensed });
  await publishHandoff({ from: "pax", to: ["penny"], visit_id: visit.id, kind: "dispensed", payload: { dispensed } });
  return tryInvoice(visit.id);
}

// ---------- 10–12. Invoice → email → memory note → closed ----------

/** Runs once the visit is DISPENSED and coverage is decided (whichever finishes last calls it). */
async function tryInvoice(visitId: string): Promise<Visit> {
  let visit = await loadVisit(visitId);
  if (visit.status !== "DISPENSED" || !["ACTIVE", "PARTIAL", "DENIED", "ESCALATED"].includes(visit.coverage_status)) return visit;
  const patient = await loadPatient(visit.patient_id);

  // Consultation fee + pharmacy charges, all priced in code; Penny only explains the bill.
  const lines = billingLines({ consultation_fee_cents: config.billing.consultationFeeCents, dispensed: visit.dispensed ?? [] });
  const math = computeInvoice(lines, visit.coverage);
  const notes = invoiceNotes(visit, math.balance_cents);
  const insured = visit.coverage && visit.coverage.status !== "denied";
  const penny = await runAgent({
    agent: "penny",
    kind: "invoice",
    instruction:
      "Write the patient's itemized bill: each line with its charge, what insurance covers and what the patient owes, then the totals and the outstanding balance. " +
      "If amount_due is $0.00, say clearly that insurance covers the bill and there is nothing to pay. The amounts are final; quote them verbatim.",
    data: {
      patient_name: patient.full_name,
      lines: math.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: formatCents(l.unit_price_cents),
        total: formatCents(l.total_cents),
        insurance_covers: formatCents(l.covered_cents),
      })),
      charges: formatCents(math.charges_cents),
      insurance_covers: formatCents(math.coverage_cents),
      amount_due: formatCents(math.balance_cents),
      nothing_to_pay: math.balance_cents === 0,
      insurance: insured ? { plan: visit.coverage!.plan, status: visit.coverage!.status, copay: formatCents(visit.coverage!.copay_cents) } : null,
      coverage_status: visit.coverage_status,
      // Why insurance wasn't claimed, when Ivy couldn't verify it.
      insurance_not_claimed_reason: visit.coverage_escalation_reason,
      // Comments printed on the bill; mention them, don't contradict them.
      notes,
    },
    schema: PennyNote,
    visitId: visit.id,
  });

  const invoice = { ...math, notes, explanation: penny.explanation };
  visit = await transition(visit, "INVOICED", { invoice });
  // Booking requires an email, so every patient who gets this far has one.
  if (!patient.email) throw new Error(`patient ${patient.id} has no email for the invoice`);
  const email = invoiceEmail({
    clinic_name: config.clinic.name,
    patient: { name: patient.full_name, email: patient.email },
    visit,
    invoice,
  });
  await sendInvoiceEmail({ visit_id: visit.id, email, invoice });

  // Dr. Sage reads these at the patient's next consult.
  await repo.addMemoryNote({ patient_id: patient.id, visit_id: visit.id, note: visitSummary(visit) });
  return transition(visit, "CLOSED");
}

function visitSummary(v: Visit): string {
  const flags = v.rx_safety?.issues.map((i) => `${i.drug || i.kind}: ${i.detail}`) ?? [];
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
    ...(v.status === "RX_FLAGGED" ? [{ visit_id: v.id, item: "pharmacy flagged the prescription" }] : []),
    ...(v.history_update && !v.history_update_approved && v.status !== "CANCELLED" ? [{ visit_id: v.id, item: "approve history update" }] : []),
  ]);
}
