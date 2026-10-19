import { requireStaff, route } from "@/lib/http";
import { runCoverage } from "@/lib/visit/flow";

export const maxDuration = 300;

/** Run (or re-run) Ivy's coverage check. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return runCoverage(id);
});
