import { after } from "next/server";
import { z } from "zod";
import { repo } from "@/lib/db";
import { HttpError, notFound, readBody, requireStaff, route } from "@/lib/http";
import { checkIn, runCoverage } from "@/lib/visit/flow";

const Body = z.object({ full_name: z.string().min(1), dob: z.string().min(1) });

/** Staff-side check-in (the patient normally checks in through Riley in the chat). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  const visit = await repo.getVisit(id);
  if (!visit) throw notFound("visit");
  const res = await checkIn({ visit, claimed: await readBody(req, Body) });
  if (!res.verified) throw new HttpError(422, "identity does not match the record");
  after(() => runCoverage(id).catch((err) => console.error("[coverage]", err)));
  return res.visit;
});
