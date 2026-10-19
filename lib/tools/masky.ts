/** Masky.AI — faces and voices. Created once in Masky; we only serve the stored URLs. */
import { config } from "@/lib/config";
import type { AgentName } from "@/lib/types";

export const AGENT_PROFILES: Record<AgentName, { display: string; role: string }> = {
  riley: { display: "Riley", role: "Front Desk" },
  sage: { display: "Dr. Sage", role: "Doctor Agent" },
  ivy: { display: "Ivy", role: "Insurance" },
  pax: { display: "Pax", role: "Pharmacy" },
  penny: { display: "Penny", role: "Billing" },
};

export function agentProfiles() {
  return (Object.keys(AGENT_PROFILES) as AgentName[]).map((name) => ({
    name,
    ...AGENT_PROFILES[name],
    avatar_url: config.masky.avatar(name) ?? null,
    video_url: config.masky.video(name) ?? null,
    voice_url: config.masky.voice(name) ?? null,
  }));
}
