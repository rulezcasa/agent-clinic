import { z } from "zod";
import { runAgent } from "@/lib/agents/run";
import { readBody, requireStaff, route } from "@/lib/http";

export const maxDuration = 120;

const Body = z.object({ agent: z.enum(["riley", "sage", "ivy", "pax", "penny"]) });
const Pong = z.object({ ok: z.boolean(), agent: z.string() });

/** Round-trip test: post a task to one agent in #clinic-ops and wait for its JSON reply. */
export const POST = route(async (req: Request) => {
  requireStaff(req);
  const { agent } = await readBody(req, Body);
  const started = Date.now();
  const reply = await runAgent({
    agent,
    kind: "ping",
    instruction: `Connection test. Reply with ok: true and agent: "${agent}".`,
    data: {},
    schema: Pong,
  });
  return { reply, ms: Date.now() - started };
});
