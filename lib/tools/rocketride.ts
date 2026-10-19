/**
 * RocketRide — sends the Rx to the rx-safety pipeline configured in RocketRide (by its token).
 * The backend sends {allergies, formulary, rx_text, items}; the pipeline returns {status, issues[]} (allergies, interactions;
 * stock is checked by Pax after approval).
 * The code severe-allergy block (lib/rules/allergy.ts) still runs afterwards as a backstop.
 */
import { z } from "zod";
import { config, need } from "@/lib/config";
import type { Allergy, Drug, RxItem, RxSafetyResult } from "@/lib/types";

const IssueSchema = z.object({
  kind: z.enum(["allergy", "out_of_stock", "interaction", "unknown_drug", "pharmacist"]),
  drug: z.string(),
  detail: z.string(),
  severity: z.enum(["block", "warn"]).default("block"),
  alternatives: z.array(z.string()).default([]),
});
const PipelineOutput = z.object({
  status: z.enum(["clear", "flagged", "blocked"]),
  issues: z.array(IssueSchema).default([]),
});

export function rxToText(items: RxItem[]): string {
  return items.map((i) => `${i.drug} ${i.dose}, ${i.frequency} for ${i.days} days (qty ${i.quantity})`).join("\n");
}

/** Find the {status, issues} object anywhere in a pipeline result (fields vary by pipeline config). */
function findOutput(result: unknown): z.infer<typeof PipelineOutput> | null {
  const seen = new Set<unknown>();
  const visit = (v: unknown): z.infer<typeof PipelineOutput> | null => {
    if (v == null || seen.has(v)) return null;
    if (typeof v === "string") {
      const s = v.trim();
      const start = s.indexOf("{");
      if (start === -1) return null;
      try {
        return visit(JSON.parse(s.slice(start, s.lastIndexOf("}") + 1)));
      } catch {
        return null;
      }
    }
    if (typeof v !== "object") return null;
    seen.add(v);
    const parsed = PipelineOutput.safeParse(v);
    if (parsed.success) return parsed.data;
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return null;
  };
  return visit(result);
}

export async function runRxSafety(input: { allergies: Allergy[]; formulary: Drug[]; items: RxItem[] }): Promise<RxSafetyResult> {
  // Imported lazily so the SDK (websocket client) only loads when actually used.
  const { RocketRideClient } = await import("rocketride");
  const client = new RocketRideClient({ auth: need(config.rocketride.apiKey, "ROCKETRIDE_APIKEY"), uri: need(config.rocketride.uri, "ROCKETRIDE_URI") });
  await client.connect();
  try {
    const body = JSON.stringify({
      allergies: input.allergies,
      formulary: input.formulary.map(({ name, generic, drug_class, indication, allergens, interacts_with }) => ({
        name,
        generic,
        drug_class,
        indication,
        allergens,
        interacts_with,
      })),
      rx_text: rxToText(input.items),
      items: input.items,
    });
    const result = await client.send(need(config.rocketride.pipelineToken, "ROCKETRIDE_PIPELINE_TOKEN"), body, { name: "rx.json" }, "application/json");
    const out = findOutput(result);
    if (!out) throw new Error(`rx-safety pipeline returned no {status, issues}: ${JSON.stringify(result).slice(0, 300)}`);
    return { ...out, source: "rocketride" };
  } finally {
    await client.disconnect().catch(() => {});
  }
}
