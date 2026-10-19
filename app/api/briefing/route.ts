import { requireN8n, route } from "@/lib/http";
import { dailyBriefing } from "@/lib/visit/flow";

export const maxDuration = 300;

/** n8n 6pm schedule → Dr. Sage's end-of-day briefing. */
export const POST = route(async (req: Request) => {
  requireN8n(req);
  return dailyBriefing();
});
