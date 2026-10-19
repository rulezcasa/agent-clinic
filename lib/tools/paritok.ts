/** Paritok — compresses patient history + memory notes before Dr. Sage reads them. */
import { config, need } from "@/lib/config";
import { postJson } from "./http";

export async function compressContext(text: string, targetTokens = 400): Promise<string> {
  const res = await postJson<{ text?: string; compressed?: string } | string>(
    need(config.paritok.apiUrl, "PARITOK_API_URL"),
    { text, target_tokens: targetTokens },
    { apiKey: config.paritok.apiKey },
  );
  const out = typeof res === "string" ? res : (res.compressed ?? res.text);
  if (!out) throw new Error("Paritok returned no text");
  return out;
}
