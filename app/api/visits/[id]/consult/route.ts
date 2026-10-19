import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { startConsult } from "@/lib/visit/flow";

export const maxDuration = 300;

const Body = z.object({ transcript: z.string().min(1) });

/** "Generate prescription": the consult transcript → Dr. Sage drafts (its summary is saved as the consult notes) → waits for the doctor. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return startConsult(id, (await readBody(req, Body)).transcript);
});
