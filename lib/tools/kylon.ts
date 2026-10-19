/**
 * Kylon transport — the backend posts a task in the clinic room that @mentions an agent
 * (the room is "mentioned only"), then reads recent room messages for that agent's JSON reply.
 * Runs the `kylon` CLI as whoever is logged in (`kylon auth login`) or via KYLON_WORKSPACE_API_KEY.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config, need } from "@/lib/config";
import type { AgentName } from "@/lib/types";

const run = promisify(execFile);

interface RoomMessage {
  id: string;
  senderType: string; // "agent" | "human" | "system"
  senderName: string;
  content: string;
  sentAt: string;
}

async function kylon(args: string[]): Promise<{ details?: Record<string, unknown> }> {
  const scope = config.kylon.workspaceId ? ["--scope-workspace", config.kylon.workspaceId] : [];
  const { stdout } = await run(config.kylon.bin, ["workspace", ...args, ...scope, "--json"], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  const out = JSON.parse(stdout);
  if (!out.ok) throw new Error(`kylon ${args[0]} ${args[1]}: ${out.text ?? stdout.slice(0, 300)}`);
  return out;
}

const room = () => need(config.kylon.roomId, "KYLON_ROOM_ID");

export async function postMessage(text: string, mentionIds: string[]): Promise<void> {
  await kylon(["message", "send", "--room", room(), "--text", text, ...(mentionIds.length ? ["--mentions", mentionIds.join(",")] : [])]);
}

/** Recent top-level room messages, newest first (only those after `since`, if given). */
export async function recentMessages(limit = 30, since?: string): Promise<RoomMessage[]> {
  const out = await kylon(["history", "recent", "--room", room(), "--limit", String(limit), ...(since ? ["--since", since] : [])]);
  return (out.details?.messages as RoomMessage[]) ?? [];
}

/** Pull the first JSON object out of a chat reply (handles ```json fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fenced ? [fenced[1]] : [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  throw new Error("no JSON object found in agent reply");
}

/**
 * Post a task and wait for the agent's reply carrying the same task id.
 * Agents echo `task_id` in their JSON (see their Kylon instructions), so replies match reliably.
 */
export async function askAgentInRoom(agent: AgentName, taskId: string, text: string): Promise<unknown> {
  const name = config.kylon.agentName(agent);
  // Only read messages from around when the task was posted (a minute of slack for clock skew).
  const since = new Date(Date.now() - 60_000).toISOString();
  await postMessage(text, [need(config.kylon.agentId(agent), `KYLON_AGENT_ID_${agent.toUpperCase()}`)]);
  const deadline = Date.now() + config.kylon.replyTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, config.kylon.pollIntervalMs));
    const reply = (await recentMessages(20, since)).find((m) => m.senderType === "agent" && m.senderName === name && m.content.includes(taskId));
    if (reply) return extractJson(reply.content);
  }
  throw new Error(`Kylon: no reply from ${name} for task ${taskId} within ${config.kylon.replyTimeoutMs}ms`);
}
