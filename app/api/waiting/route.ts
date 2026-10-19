import { requireStaff, route } from "@/lib/http";
import { waitingForDoctor } from "@/lib/visit/flow";

/** What is waiting on the human doctor. */
export const GET = route(async (req: Request) => {
  requireStaff(req);
  return waitingForDoctor();
});
