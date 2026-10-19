import { z } from "zod";
import { readBody, requireStaff, route } from "@/lib/http";
import { overrideCoverage } from "@/lib/visit/flow";

export const maxDuration = 300;

const Pct = z.number().min(0).max(100);
const Body = z.object({
  status: z.enum(["active", "partial", "denied"]),
  plan: z.string(),
  insurer_pays_pct: z.object({ visit: Pct, procedure: Pct, rx: Pct }),
  copay_cents: z.number().int().min(0),
  notes: z.string().default(""),
});

/** Human doctor resolves coverage Ivy escalated. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  return overrideCoverage(id, await readBody(req, Body));
});
