/** Small JSON-over-HTTP helper used by the REST-style adapters. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  opts: { apiKey?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      ...opts.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function getJson<T = unknown>(url: string, opts: { apiKey?: string; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}), ...opts.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}
