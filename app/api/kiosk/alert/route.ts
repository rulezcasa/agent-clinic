import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { kioskAlert } from "@/lib/visit/kiosk";

const Body = z.object({ complaint: z.string().min(1).max(500), visit_id: z.string().uuid().nullish(), patient_id: z.string().uuid().nullish() });

/** Riley's kiosk: a patient described emergency symptoms. Logs it for the doctor (and on BAND when a visit is known). */
export const POST = route(async (req: Request) => {
  requireStaff(req);
  return kioskAlert(await readBody(req, Body));
});
