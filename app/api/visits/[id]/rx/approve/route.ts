import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { approveRx } from "@/lib/visit/flow";

export const maxDuration = 300;

const Body = z.object({ approved_by: z.string().min(1) });

/** Human doctor approves → Pax dispenses → invoice when coverage is ready. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return approveRx(id, (await readBody(req, Body)).approved_by);
});
