import { z } from "zod";
import { readBody, requireN8n, route } from "@/lib/http";
import { createVisitFromBooking } from "@/lib/visit/flow";

// n8n forwards Cal.com's BOOKING_CREATED webhook body as-is.
const Body = z.object({
  payload: z.object({
    uid: z.string(),
    startTime: z.string(),
    metadata: z.object({
      patient_id: z.string().uuid(),
      session_id: z.string().uuid().nullish(),
      reason: z.string().nullish(),
    }),
  }),
});

export const POST = route(async (req: Request) => {
  requireN8n(req);
  const { payload: b } = await readBody(req, Body);
  return createVisitFromBooking({ uid: b.uid, start: b.startTime, patient_id: b.metadata.patient_id, session_id: b.metadata.session_id, reason: b.metadata.reason });
});
