import { after } from "next/server";
import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { runCoverage } from "@/lib/visit/flow";
import { kioskCheckIn } from "@/lib/visit/kiosk";

const Body = z.object({
  visit_id: z.string().uuid(),
  full_name: z.string().min(1).max(120),
  dob: z.string().min(8).max(10),
  complaint: z.string().max(500).nullish(),
  insurance_payer: z.string().max(80).nullish(),
  insurance_member_id: z.string().max(40).nullish(),
  group_number: z.string().max(40).nullish(),
});

/** Riley's kiosk: check in for today's visit. Same path as the chat: BAND intake → Ivy + Dr. Sage, then Ivy's insurance check (result posted on BAND). */
export const POST = route(async (req: Request) => {
  requireStaff(req);
  const res = await kioskCheckIn(await readBody(req, Body));
  if (res.verified && res.visit) {
    const id = res.visit.id;
    after(() => runCoverage(id).catch((err) => console.error("[coverage]", err)));
  }
  return res;
});
