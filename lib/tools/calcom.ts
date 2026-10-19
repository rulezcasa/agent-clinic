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
  // A few slots per day (morning to afternoon) so Riley can offer every day, not just today.
  return Object.values(res.data ?? {}).flatMap((day) => spread(day, 6).map((s) => ({ start: s.start })));
}

/** Pick `n` evenly spaced items, keeping the first. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
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
