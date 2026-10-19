import { after } from "next/server";
import { z } from "zod";
import { readBody, route } from "@/lib/http";
import { chatTurn, runCoverage } from "@/lib/visit/flow";

export const maxDuration = 300;

const Body = z.object({
  session_id: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  desk: z.enum(["booking", "checkin"]).default("booking"),
});

/** Patient chat page → Riley (booking tab or check-in tab). Omit session_id to start a new chat. */
export const POST = route(async (req: Request) => {
  const res = await chatTurn(await readBody(req, Body));
  // Step 6: Ivy checks coverage in the background once the patient is checked in.
  if (res.checked_in && res.visit) {
    const visitId = res.visit.id;
    after(() => runCoverage(visitId).catch((err) => console.error("[coverage]", err)));
  }
  return res;
});
