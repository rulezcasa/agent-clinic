# Agent Clinic

**A small clinic's front desk, scribe, insurance desk, pharmacy and billing, run fully by AI agents. A human doctor still approves every prescription (human-in-the-loop for critical decisions).** 

---

## Team
Built at the Universal hackathon at SF, Won the 2nd place !

---


## Problem

Most of a small clinic's day goes to admin work around each visit, not to the patient:

- **Front desk:** booking, rescheduling, check-in, checking identity, writing down allergies.
- **Insurance:** checking eligibility, network status and how much deductible is left, usually by phone or on payer portals.
- **Charting and prescriptions:** the doctor writes notes and prescriptions after the visit instead of talking to the patient.
- **Pharmacy and billing:** checking stock, allergies and drug interactions, then working out what insurance pays and what the patient owes.

Each of these hand-offs is slow and easy to get wrong. Letting a single LLM "run the clinic" is risky, though: models get numbers wrong, invent facts and skip safety checks.

## Solution

Agent Clinic splits the visit into narrow jobs. Each job is done by one agent and the autonomously hand off tasks to each other with a deterministic backend controls the whole flow.

| Agent | Role | What it does |
|---|---|---|
| **Riley** | Receptionist | Talks with patients by voice or text on the website and at the kiosk. Books slots from the doctor's real calendar and checks patients in (name, DOB, allergies, insurance). |
| **Ivy** | Insurance verifier | Runs async in the background after the patinet has checked-in. Reads facts the code computed (member, plan dates, network, remaining deductible and out-of-pocket) and explains them. Ivy can make the coverage decision stricter but never looser. If she escalates, she writes down why. |
| **Dr. Sage** | AI scribe | Listens to the consultation transcript, writes the summary and a draft prescription, and proposes a history update. Also writes the doctor's daily briefing. |
| **Pax** | Pharmacist | Checks the prescription the doctor approved against the formulary, stock, allergies and interactions, then dispenses it or flags it back to the doctor. |
| **Penny** | Billing | Creates the invoice and emails it to the patient with insurance coverage accounted for. |


## Architecture

```
            Patient (web chat / voice kiosk)                Doctor (consult room)
                        │                                          │
                        ▼                                          ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                  Next.js 16 backend: the only controller                     │
   │                                                                              │
   │  lib/visit/flow.ts    visit orchestration      lib/rules/*  deterministic    │
   │  lib/visit/status.ts  state machine                         identity,        │
   │  lib/agents/run.ts    runAgent(): task → JSON → Zod         insurance,       │
   │                                                             quantity,        │
   │                                                             invoice math     │
   └──────┬──────────────┬───────────────┬──────────────┬───────────────┬─────────┘
          │              │               │              │               │
          ▼              ▼               ▼              ▼               ▼
     ┌─────────┐   ┌──────────┐    ┌──────────┐   ┌──────────┐    ┌──────────┐
     │  Kylon  │   │   BAND   │    │ Supabase │   │ Cal.com  │    │   n8n    │
     │ agents' │   │  shared  │    │ Postgres │   │ calendar │    │ webhooks │
     │ runtime │   │ handoffs │    │ records  │   │          │    │ & email  │
     └────┬────┘   └──────────┘    └──────────┘   └──────────┘    └──────────┘
          │
   Riley · Ivy · Dr. Sage · Pax · Penny       + Paritok (history compression)
                                              + Masky   (agent faces & voices)
```

**How an agent call works (`runAgent`)**

1. The backend posts a task in the Kylon `#clinic-ops` room, @mentioning the agent. The task contains the instruction, the task data, and the JSON schema the reply must match.
2. The backend reads the visit's earlier handoffs from BAND and attaches them as `band_context`.
3. The agent replies with JSON. The backend validates it with Zod, logs it to `messages`, and only then moves the visit forward.
4. The result goes back to BAND as a handoff packet `{from, to, visit_id, kind, payload}`, so the next agent gets the context.

### Visit lifecycle

```
BOOKED → CHECKED_IN → IN_CONSULT → RX_DRAFTED → RX_PENDING_APPROVAL → RX_APPROVED → DISPENSED → INVOICED → CLOSED
                           │                                               │    ▲
                           │ (no prescription)                             ▼    │ doctor edits
                           └──────────────────────► DISPENSED          RX_FLAGGED ┘
```

Coverage runs **in parallel** on its own field (`NOT_STARTED → PENDING → ACTIVE | PARTIAL | DENIED | ESCALATED`). It never blocks the visit, only the invoice. Whichever finishes last, dispensing or coverage, triggers invoicing.

### End-to-end flow

1. **Book:** The patient chats with Riley. The backend fetches free slots from Cal.com and creates the booking. Cal.com's `BOOKING_CREATED` event goes through n8n to `POST /api/booking`, which creates the visit.
2. **Check in:** On the web or at the kiosk, Riley collects name, DOB, allergies and insurance. Code verifies identity; the kiosk also checks the last 4 digits of the phone number on file.
3. **Insurance:** This runs asynchronously. Code looks up the member, plan and network and computes what remains. Ivy reviews the result and posts `coverage_result` to BAND.
4. **Consult:** The browser transcribes the doctor–patient conversation live. Paritok compresses the patient's history and memory notes, then Dr. Sage drafts the summary and prescription.
5. **Approve:** The doctor edits the prescription and saves it. Saving is the approval.
6. **Dispense:** Pax checks the formulary, stock, allergies and interactions, then either dispenses or flags the prescription back to the doctor.
7. **Invoice:** Code computes the consultation fee plus drugs at formulary prices, minus coverage, with the copay as a floor. Penny writes the explanation, code renders the email, and n8n sends it.
8. **Remember:** A memory note is saved for the patient's next visit, and the visit closes. Every day at 6 pm, an n8n schedule asks Dr. Sage for the daily briefing.

## Tools we use

| Tool | What we use it for |
|---|---|
| **Kylon** | Runtime for the agents. Each agent's instructions live in Kylon. The backend sends tasks by @mentioning an agent in the `#clinic-ops` room and reads back its JSON reply. |
| **BAND** | Shared context between agents. Every handoff packet is posted as a `task` event in the clinic BAND room and sent back as `band_context` before the next agent's task. |
| **Supabase (Postgres)** | System of record: patients, visits, drug formulary, insurance plans, members and networks, chat sessions, the message timeline and memory notes. RLS is on and only the service role is used. |
| **Cal.com** | The doctor's real calendar. Provides free slots for Riley and creates bookings. Its webhooks start visit creation. |
| **n8n** | Automation and email. Forwards Cal.com booking webhooks to the backend, sends the invoice email the code rendered, and runs the 6 pm daily briefing schedule. |
| **Paritok** | Compresses patient history and memory notes before Dr. Sage reads them, so long histories fit in a small context without losing allergies, conditions or medications. |
| **Masky.AI** | Faces and voices for the agents. Each agent has a Masky avatar, and Riley's replies are spoken aloud at the kiosk and on the web. |
| **Web Speech API** | Speech-to-text in the browser, for patients talking to Riley and for the live consult transcript. |
| **Next.js 16 + React 19** | Frontend (booking, check-in and doctor's room tabs) and API routes (the backend controller). |
| **Zod** | Schemas for every agent reply. They are converted to JSON Schema for the task prompt and used to validate each response. |
| **ngrok** | Lets a frontend-only deploy forward `/api/*` to the backend machine (`proxy.ts` + `BACKEND_URL`). |

## Safety and correctness

- **Identity:** Exact name and DOB match in code, with the phone number's last 4 digits as a second factor at the kiosk. On failure the system never says which part was wrong.
- **Insurance:** Every number comes from code (`lib/rules/insurance.ts`). Statuses are ordered `covered < partial < denied < needs_review`, and Ivy can only move the status towards stricter. If insurance can't be verified, it isn't claimed, and the invoice says why.
- **Prescriptions:** The doctor's save is the approval. Pax's "cleared" result must still pass the formulary and stock checks in code. Quantities are calculated from dose × frequency × days.
- **Invoice:** `balance = charges − coverage` in integer cents. Coverage per line is `floor(total × pct / 100)`, capped so the patient always pays at least the copay.
- **Audit trail:** Every patient message, agent task, agent reply and handoff is stored in `messages`, so a visit's timeline can be replayed.
- **Staff routes** (approving prescriptions and history) require `Authorization: Bearer $CLINIC_STAFF_TOKEN`. Inbound n8n calls require the `x-clinic-secret` header.

## Project structure

```
app/
  page.tsx                  Front desk UI: Book · Check-in · Doctor tabs
  _components/              Riley chat, doctor room, consult room, speech helpers
  api/
    chat/                   Patient ↔ Riley turns
    booking/  slots/        Cal.com webhook (via n8n), free slots
    kiosk/                  verify · book · checkin · insurance · alert (voice kiosk)
    visits/[id]/            checkin · consult · rx/approve · history/approve · coverage · cancel
    briefing/  waiting/     Daily briefing, doctor's waiting list
    agents/  kylon/ping/    Agent roster + avatars, Kylon connection test
lib/
  visit/                    flow.ts (orchestration), status.ts (state machine), insurance.ts, kiosk.ts
  agents/                   run.ts (runAgent), schemas.ts (Zod reply schemas)
  rules/                    Deterministic logic: identity, insurance, formulary, quantity, invoice, invoice email
  tools/                    Adapters: kylon, band, calcom, n8n, paritok, masky
supabase/
  migrations/               0001 core schema · 0002 insurance · 0003 escalation reason
  seed.sql                  Formulary, insurance plans/members/networks
proxy.ts                    Forwards /api/* to BACKEND_URL on frontend-only deploys
```
