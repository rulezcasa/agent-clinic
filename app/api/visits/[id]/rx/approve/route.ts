import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { approveRx } from "@/lib/visit/flow";

export const maxDuration = 300;

const Item = z.object({
  drug: z.string().min(1),
  dose: z.string(),
  frequency: z.string().min(1),
  days: z.number().int().positive(),
  quantity: z.number().int().positive().nullable(), // null → derived from frequency × days
});
const Body = z.object({ approved_by: z.string().min(1), items: z.array(Item).min(1) });

/** The doctor saves the prescription as edited (= approved) → BAND handoff to Pax → Pax dispenses → invoice when coverage is ready. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  const { approved_by, items } = await readBody(req, Body);
  return approveRx(id, approved_by, items);
});
