import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { startConsult } from "@/lib/visit/flow";

export const maxDuration = 300;

const Body = z.object({ notes: z.string().min(1) });

/** Human doctor's consult notes → Dr. Sage drafts → RocketRide + Pax check → waits for approval. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return startConsult(id, (await readBody(req, Body)).notes);
});
