import { requireStaff, route } from "@/lib/http";
import { approveHistory } from "@/lib/visit/flow";

/** Human doctor approves Dr. Sage's proposed medical-history update. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return approveHistory(id);
});
