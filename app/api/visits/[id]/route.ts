import { repo } from "@/lib/db";
import { notFound, requireStaff, route } from "@/lib/http";

/** Visit + patient + full timeline (chat, Kylon tasks, BAND handoffs, status moves) + memory notes. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireStaff(req);
  const { id } = await ctx.params;
  const visit = await repo.getVisit(id);
  if (!visit) throw notFound("visit");
  const [patient, timeline, memory_notes] = await Promise.all([
    repo.getPatient(visit.patient_id),
    repo.listMessages({ visit_id: id }),
    repo.listMemoryNotes(visit.patient_id),
  ]);
  return { visit, patient, timeline, memory_notes };
});
