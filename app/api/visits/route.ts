import { repo } from "@/lib/db";
import { requireStaff, route } from "@/lib/http";
import { VISIT_STATUSES, type VisitStatus } from "@/lib/types";

/** Staff list. ?status=RX_PENDING_APPROVAL,RX_FLAGGED  ?patient_id=... */
export const GET = route(async (req: Request) => {
  requireStaff(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.split(",").filter((s): s is VisitStatus => (VISIT_STATUSES as readonly string[]).includes(s));
  return repo.listVisits({ status: status?.length ? status : undefined, patient_id: url.searchParams.get("patient_id") ?? undefined });
});
