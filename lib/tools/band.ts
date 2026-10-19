/**
 * BAND — the agents' shared context. Kylon does the calling; BAND holds what each agent handed on.
 * Every handoff packet {from, to, visit_id, kind, payload} is posted as a `task` event in the clinic
 * BAND room (Agent API, the backend is a BAND agent). Before a visit task, runAgent reads that
 * visit's handoffs back with visitContext() and gives them to the agent as `band_context`.
 * Each handoff is also saved to `messages` so the staff timeline can replay it.
 */
import { config, need } from "@/lib/config";
import { repo } from "@/lib/db";
import type { AgentName } from "@/lib/types";

export interface HandoffPacket {
  from: AgentName | "backend" | "doctor";
  to: (AgentName | "doctor")[];
  visit_id: string;
  kind: string; // e.g. "intake", "rx_check", "coverage_result", "dispensed"
  payload: Record<string, unknown>;
}

interface BandMessage {
  content: string;
  message_type: string;
  inserted_at: string;
  metadata: { handoff?: HandoffPacket & { sent_at: string } } | null;
}

async function band<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.band.apiUrl}/chats/${need(config.band.roomId, "BAND_ROOM_ID")}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": need(config.band.apiKey, "BAND_API_KEY") },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`BAND ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function publishHandoff(packet: HandoffPacket): Promise<void> {
  const handoff = { ...packet, sent_at: new Date().toISOString() };
  await band("/events", {
    method: "POST",
    body: JSON.stringify({
      event: { content: `${packet.kind}: ${packet.from} → ${packet.to.join(", ")} (visit ${packet.visit_id})`, message_type: "task", metadata: { handoff } },
    }),
  });
  await repo.addMessage({
    visit_id: packet.visit_id,
    session_id: null,
    channel: "band",
    sender: packet.from,
    recipient: packet.to.join(","),
    body: `${packet.kind}: ${packet.from} → ${packet.to.join(", ")}`,
    payload: { ...packet },
  });
}

/** Every handoff posted on BAND for this visit, oldest first. */
export async function visitContext(visitId: string) {
  const out: (HandoffPacket & { sent_at: string })[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: BandMessage[]; metadata: { next_cursor: string | null } } = await band(
      `/context?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    for (const m of page.data) if (m.message_type === "task" && m.metadata?.handoff?.visit_id === visitId) out.push(m.metadata.handoff);
    cursor = page.metadata.next_cursor;
  } while (cursor);
  return out.map(({ from, to, kind, payload, sent_at }) => ({ from, to, kind, payload, sent_at }));
}
