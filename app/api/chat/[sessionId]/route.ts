import { repo } from "@/lib/db";
import { notFound, route } from "@/lib/http";

/** Chat history for the patient page. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ sessionId: string }> }) => {
  const { sessionId } = await ctx.params;
  const session = await repo.getSession(sessionId);
  if (!session) throw notFound("chat session");
  const messages = (await repo.listMessages({ session_id: sessionId })).filter((m) => m.channel === "patient_chat");
  return { session, messages: messages.map(({ id, sender, body, created_at }) => ({ id, sender, body, created_at })) };
});
