import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { kioskBook } from "@/lib/visit/kiosk";

const NewPatient = z.object({
  full_name: z.string().min(1).max(120),
  dob: z.string().min(8).max(10),
  email: z.string().email(),
  phone: z.string().max(20).nullish(),
  insurance_payer: z.string().max(80).nullish(),
  insurance_member_id: z.string().max(40).nullish(),
});
const Body = z
  .object({ patient_id: z.string().uuid().nullish(), patient: NewPatient.nullish(), slot: z.string().min(10), reason: z.string().max(500).nullish() })
  .refine((b) => b.patient_id || b.patient, "patient_id or patient is required");

export const maxDuration = 60;

/** Riley's kiosk: book a slot from GET /api/slots on Cal.com (visit arrives via n8n → /api/booking). */
export const POST = route(async (req: Request) => {
  requireStaff(req);
  return kioskBook(await readBody(req, Body));
});
