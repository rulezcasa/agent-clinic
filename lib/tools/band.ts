/**
 * BAND — the mailbox between agents. Every handoff packet {from, to, visit_id, payload}
 * is published on BAND and also saved to `messages` so the staff timeline can replay it.
 */
import { config, need } from "@/lib/config";
import { repo } from "@/lib/db";
import type { AgentName } from "@/lib/types";
import { postJson } from "./http";

export interface HandoffPacket {
  from: AgentName | "backend";
  to: (AgentName | "doctor")[];
  visit_id: string;
  kind: string; // e.g. "intake", "rx_check", "coverage_result", "dispensed"
  payload: Record<string, unknown>;
}

export async function publishHandoff(packet: HandoffPacket): Promise<void> {
  await postJson(
    need(config.band.publishUrl, "BAND_PUBLISH_URL"),
    { room_id: config.band.roomId, ...packet, sent_at: new Date().toISOString() },
    { apiKey: config.band.apiKey },
  );
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
