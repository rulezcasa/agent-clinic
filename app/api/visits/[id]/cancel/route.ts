import { repo } from "@/lib/db";
import { notFound, requireStaff, route } from "@/lib/http";
import { transition } from "@/lib/visit/status";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  const visit = await repo.getVisit(id);
  if (!visit) throw notFound("visit");
  return transition(visit, "CANCELLED");
});
