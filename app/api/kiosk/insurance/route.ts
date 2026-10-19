import { after } from "next/server";
import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { runCoverage } from "@/lib/visit/flow";
import { kioskInsurance } from "@/lib/visit/kiosk";

const Body = z.object({
  visit_id: z.string().uuid(),
  full_name: z.string().min(1).max(120),
  dob: z.string().min(8).max(10),
  insurance_payer: z.string().max(80).nullish(),
  insurance_member_id: z.string().max(40).nullish(),
});

/**
 * Riley's kiosk: hand the patient's insurance to Ivy. Returns at once (coverage PENDING); Ivy verifies
 * in the background and posts `coverage_result: ivy → penny` (approved/rejected + coverage left) on BAND.
 */
export const POST = route(async (req: Request) => {
  requireStaff(req);
  const res = await kioskInsurance(await readBody(req, Body));
  if (!res.already_running) after(() => runCoverage(res.visit_id).catch((err) => console.error("[coverage]", err)));
  return res;
});
