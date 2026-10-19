/**
 * Paritok — compresses patient history + memory notes before Dr. Sage reads them.
 * Hosted direct compression API: POST {content, query} → {compressed, gpu_available, original_tokens, compressed_tokens}.
 */
import { config, need } from "@/lib/config";
import { postJson } from "./http";

/** What Dr. Sage needs kept when the history is shrunk. */
const QUERY = "Prescribing a medication: keep allergies and reactions, chronic conditions, current medications, and past prescriptions and how they went.";

export async function compressContext(text: string): Promise<string> {
  if (!text.trim()) return "";
  const res = await postJson<{ compressed: string; gpu_available: boolean; original_tokens?: number; compressed_tokens?: number }>(
    config.paritok.apiUrl,
    { content: text, query: QUERY },
    { apiKey: need(config.paritok.apiKey, "PARITOK_API_KEY") },
  );
  if (!res?.compressed) throw new Error("Paritok returned no text");
  return res.compressed;
}
