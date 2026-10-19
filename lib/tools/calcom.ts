/**
 * Cal.com — the doctor's calendar. Riley never calls Cal.com; the backend fetches free
 * slots for Riley's task and creates the booking when Riley replies {action:"book"}.
 * Cal.com then fires BOOKING_CREATED → n8n → POST /api/booking, which creates the visit.
 */
import { config, need } from "@/lib/config";
import { getJson, postJson } from "./http";

export interface Slot {
  start: string; // ISO
}

export async function getFreeSlots(days = 5): Promise<Slot[]> {
  const start = new Date();
  const end = new Date(start.getTime() + days * 86_400_000);
  const qs = new URLSearchParams({
    eventTypeId: need(config.calcom.eventTypeId, "CALCOM_EVENT_TYPE_ID"),
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: config.calcom.timeZone,
  });
  const res = await getJson<{ data: Record<string, { start: string }[]> }>(`${config.calcom.apiUrl}/slots?${qs}`, {
    apiKey: need(config.calcom.apiKey, "CALCOM_API_KEY"),
    headers: { "cal-api-version": "2024-09-04" },
  });
  return Object.values(res.data ?? {})
    .flat()
    .map((s) => ({ start: s.start }))
    .slice(0, 12);
}

export async function createBooking(input: {
  start: string;
  name: string;
  email: string;
  patientId: string;
  sessionId: string;
  reason?: string | null;
}): Promise<{ uid: string; start: string }> {
  const res = await postJson<{ data: { uid: string; start: string } }>(
    `${config.calcom.apiUrl}/bookings`,
    {
      start: input.start,
      eventTypeId: Number(config.calcom.eventTypeId),
      attendee: { name: input.name, email: input.email, timeZone: config.calcom.timeZone },
      // n8n forwards these back to POST /api/booking so the visit links to the patient and chat
      metadata: { patient_id: input.patientId, session_id: input.sessionId, reason: input.reason ?? "" },
    },
    { apiKey: need(config.calcom.apiKey, "CALCOM_API_KEY"), headers: { "cal-api-version": "2024-08-13" } },
  );
  return { uid: res.data.uid, start: res.data.start };
}
