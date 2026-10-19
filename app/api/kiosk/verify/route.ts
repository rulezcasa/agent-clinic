import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { kioskVerify } from "@/lib/visit/kiosk";

const Body = z.object({ full_name: z.string().min(1).max(120), dob: z.string().min(8).max(10), phone_last4: z.string().regex(/^\d{4}$/).nullish() });

/** Riley's kiosk: verify a returning patient (name + DOB + last 4 of the phone on file). Kiosk holds the staff token. */
export const POST = route(async (req: Request) => {
  requireStaff(req);
  return kioskVerify(await readBody(req, Body));
});
