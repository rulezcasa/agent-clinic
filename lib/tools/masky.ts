/** Masky.AI — faces and voices. Avatars and voices are created in Masky; the backend has them speak replies. */
import { config, need } from "@/lib/config";
import type { AgentName } from "@/lib/types";
import { getJson, postJson } from "./http";

/** Masky speaks at most 500 characters per turn; cut at the last sentence end that fits. */
const MAX_SPEAK = 500;

function speakable(text: string): string {
  if (text.length <= MAX_SPEAK) return text;
  const cut = text.slice(0, MAX_SPEAK);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 0 ? cut.slice(0, end + 1) : cut;
}

interface Turn {
  id: string;
  status: string;
  audioUrl: string | null;
  errorMessage: string | null;
  mediaError: string | null;
}

/**
 * Have an agent's Masky avatar say `text` verbatim (mode "speak") and return the MP3 URL.
 * Rendering is async: post the turn, then poll the conversation until the audio lands (~5–10s).
 * The signed URL expires after about an hour.
 */
export async function speak(agent: AgentName, text: string): Promise<string> {
  const { apiUrl } = config.masky;
  const apiKey = need(config.masky.apiKey, "MASKY_API_KEY");
  const conv = await postJson<{ conversationId: string; shareSlug: string }>(
    `${apiUrl}/conversations`,
    { avatarOwnerUserId: need(config.masky.ownerId, "MASKY_OWNER_ID"), avatarId: need(config.masky.avatarId(agent), `MASKY_AVATAR_ID_${agent.toUpperCase()}`) },
    { apiKey },
  );
  const { turn } = await postJson<{ turn: Turn }>(
    `${apiUrl}/conversations/${conv.conversationId}/turn`,
    { userText: speakable(text), mode: "speak", output: "audio" },
    { apiKey },
  );

  const deadline = Date.now() + config.masky.speakTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    const { turns } = await getJson<{ turns: Turn[] }>(`${apiUrl}/conversations/by-slug/${conv.shareSlug}`, { apiKey });
    const t = turns.find((x) => x.id === turn.id);
    if (t?.errorMessage || t?.mediaError) throw new Error(`Masky: ${t.errorMessage ?? t.mediaError}`);
    if (t?.audioUrl) return t.audioUrl;
  }
  throw new Error(`Masky: no audio for ${agent} within ${config.masky.speakTimeoutMs}ms`);
}

export const AGENT_PROFILES: Record<AgentName, { display: string; role: string }> = {
  riley: { display: "Riley", role: "Front Desk" },
  sage: { display: "Dr. Sage", role: "Doctor Agent" },
  ivy: { display: "Ivy", role: "Insurance" },
  pax: { display: "Pax", role: "Pharmacy" },
  penny: { display: "Penny", role: "Billing" },
};

/** Each agent's face: its Masky avatar's still image (null if none is set in Masky). */
export async function agentProfiles() {
  const { avatars } = await getJson<{ avatars: { avatarId: string; avatarImageUrl: string | null }[] }>(`${config.masky.apiUrl}/avatars`, {
    apiKey: need(config.masky.apiKey, "MASKY_API_KEY"),
  });
  return (Object.keys(AGENT_PROFILES) as AgentName[]).map((name) => ({
    name,
    ...AGENT_PROFILES[name],
    avatar_url: avatars.find((a) => a.avatarId === config.masky.avatarId(name))?.avatarImageUrl ?? null,
  }));
}
