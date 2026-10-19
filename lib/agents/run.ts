/**
 * runAgent — the one way the backend asks an agent to do something.
 * Posts the task in #clinic-ops @mentioning the agent (its instructions live in Kylon),
 * waits for its JSON reply, validates it, and logs both to `messages` (channel "kylon").
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "@/lib/config";
import { repo } from "@/lib/db";
import { visitContext } from "@/lib/tools/band";
import { askAgentInRoom } from "@/lib/tools/kylon";
import type { AgentName } from "@/lib/types";

export interface AgentCall<S extends z.ZodObject> {
  agent: AgentName;
  kind: string; // short task label for the timeline, e.g. "draft_rx"
  instruction: string;
  data: unknown;
  schema: S;
  visitId?: string | null;
  sessionId?: string | null;
}

function taskText(agent: AgentName, taskId: string, instruction: string, data: unknown, schema: z.ZodType) {
  return [
    `@${config.kylon.agentName(agent)} [task:${taskId}] ${instruction}`,
    "Task data:",
    "```json",
    JSON.stringify(data, null, 2),
    "```",
    `Reply with ONLY a JSON object matching this schema, and include "task_id": "${taskId}".`,
    "```json",
    JSON.stringify(z.toJSONSchema(schema)),
    "```",
  ].join("\n");
}

/** Agents often leave out nullable/array fields; fill them so validation only fails on real problems. */
function fillMissing(schema: z.ZodObject, raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const [key, field] of Object.entries(schema.shape)) {
    if (out[key] !== undefined) continue;
    if (field instanceof z.ZodNullable) out[key] = null;
    else if (field instanceof z.ZodArray) out[key] = [];
  }
  return out;
}

export async function runAgent<S extends z.ZodObject>(call: AgentCall<S>): Promise<z.infer<S>> {
  const taskId = randomUUID().slice(0, 8);
  const log = { visit_id: call.visitId ?? null, session_id: call.sessionId ?? null, channel: "kylon" as const };
  // Shared context: what the other agents handed on for this visit, read back from BAND.
  if (call.visitId) call = { ...call, data: { ...(call.data as Record<string, unknown>), band_context: await visitContext(call.visitId) } };

  await repo.addMessage({
    ...log,
    sender: "backend",
    recipient: call.agent,
    body: `[${call.kind}] ${call.instruction}`,
    payload: { task_id: taskId, data: call.data as Record<string, unknown> },
  });

  const raw = await askAgentInRoom(call.agent, taskId, taskText(call.agent, taskId, call.instruction, call.data, call.schema));
  const result = call.schema.parse(fillMissing(call.schema, raw));

  await repo.addMessage({
    ...log,
    sender: call.agent,
    recipient: "backend",
    body: summarize(result),
    payload: { task_id: taskId, kind: call.kind, result: result as Record<string, unknown> },
  });
  return result;
}

function summarize(reply: unknown): string {
  const r = reply as Record<string, unknown>;
  for (const k of ["reply", "explanation", "reasoning", "notes", "briefing"]) {
    if (typeof r?.[k] === "string") return r[k] as string;
  }
  return JSON.stringify(reply).slice(0, 500);
}
