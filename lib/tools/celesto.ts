/** Celesto — sandboxed computer where AdaL's browser runs. Backend starts a session, AdaL uses it. */
import { config, need } from "@/lib/config";
import { postJson } from "./http";

export async function startSession(purpose: string): Promise<{ session_id: string }> {
  const res = await postJson<{ session_id?: string; id?: string }>(
    need(config.celesto.sessionUrl, "CELESTO_SESSION_URL"),
    { purpose },
    { apiKey: config.celesto.apiKey },
  );
  const id = res.session_id ?? res.id;
  if (!id) throw new Error("Celesto did not return a session id");
  return { session_id: id };
}
