/**
 * Finch — billing-code skill: visit type + procedures + dispensed items → coded line items.
 * Prices come from Finch (or the formulary for drugs), never from an agent.
 */
import { config, need } from "@/lib/config";
import type { LineInput } from "@/lib/rules/invoice";
import type { DispensedItem } from "@/lib/types";
import { postJson } from "./http";

export async function billingLines(input: { visit_type: string; procedures: string[]; dispensed: DispensedItem[] }): Promise<LineInput[]> {
  const res = await postJson<{ lines: LineInput[] }>(need(config.finch.apiUrl, "FINCH_API_URL"), input, { apiKey: config.finch.apiKey });
  return res.lines;
}

