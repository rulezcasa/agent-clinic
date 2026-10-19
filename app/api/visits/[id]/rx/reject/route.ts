import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { rejectRx } from "@/lib/visit/flow";

export const maxDuration = 300;

const Body = z.object({ feedback: z.string().min(1) });

/** Human doctor sends the Rx back to Dr. Sage with feedback. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return rejectRx(id, (await readBody(req, Body)).feedback);
});
