/** Central config. Every tool is called for real; set its env vars in .env.local (see .env.example). */

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

const AGENT_NAMES: Record<string, string> = { riley: "Riley", sage: "Dr. Sage", ivy: "Ivy", pax: "Pax", penny: "Penny" };

export const config = {
  supabase: {
    url: env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  },

  kylon: {
    bin: env("KYLON_BIN") ?? `${process.env.HOME}/.kylon/bin/kylon`,
    roomId: env("KYLON_ROOM_ID"), // #clinic-ops
    workspaceId: env("KYLON_WORKSPACE_ID"),
    replyTimeoutMs: Number(env("KYLON_REPLY_TIMEOUT_MS") ?? 90_000),
    pollIntervalMs: Number(env("KYLON_POLL_INTERVAL_MS") ?? 2_000),
    // Agent member ids (for --mentions) and display names (to match replies): `kylon workspace room member list <room>`
    agentId: (agent: string) => env(`KYLON_AGENT_ID_${agent.toUpperCase()}`),
    agentName: (agent: string) => env(`KYLON_AGENT_NAME_${agent.toUpperCase()}`) ?? AGENT_NAMES[agent] ?? agent,
  },

  // BAND Agent API: the backend is a BAND agent; handoffs live as events in one clinic chat room.
  band: {
    apiUrl: env("BAND_API_URL") ?? "https://api.band.ai/api/v1/agent",
    apiKey: env("BAND_API_KEY"), // the backend agent's key (X-API-Key)
    roomId: env("BAND_ROOM_ID"), // chat room id the backend agent is in
  },

  calcom: {
    apiUrl: env("CALCOM_API_URL") ?? "https://api.cal.com/v2",
    apiKey: env("CALCOM_API_KEY"),
    eventTypeId: env("CALCOM_EVENT_TYPE_ID"),
    timeZone: env("CLINIC_TIME_ZONE") ?? "America/Los_Angeles",
  },

  n8n: {
    invoiceWebhookUrl: env("N8N_INVOICE_WEBHOOK_URL"),
    // shared secret n8n sends on inbound calls (x-clinic-secret header)
    sharedSecret: env("N8N_SHARED_SECRET"),
  },

  adal: {
    eligibilityUrl: env("ADAL_ELIGIBILITY_URL"),
    memoryUrl: env("ADAL_MEMORY_URL"),
    apiKey: env("ADAL_API_KEY"),
  },

  celesto: {
    sessionUrl: env("CELESTO_SESSION_URL"),
    apiKey: env("CELESTO_API_KEY"),
  },

  paritok: {
    apiUrl: env("PARITOK_API_URL") ?? "https://www.paritok.com/api/compress",
    apiKey: env("PARITOK_API_KEY"), // pk_live_… from paritok.com → dashboard → API keys
  },

  finch: {
    apiUrl: env("FINCH_API_URL"),
    apiKey: env("FINCH_API_KEY"),
  },

  masky: {
    apiUrl: env("MASKY_API_URL") ?? "https://masky.ai/api",
    apiKey: env("MASKY_API_KEY"),
    // From `GET /api/avatars`: avatarOwnerUserId, and each agent's avatarId (its voice is set in Masky)
    ownerId: env("MASKY_OWNER_ID"),
    avatarId: (agent: string) => env(`MASKY_AVATAR_ID_${agent.toUpperCase()}`),
    speakTimeoutMs: Number(env("MASKY_SPEAK_TIMEOUT_MS") ?? 30_000),
    avatar: (agent: string) => env(`MASKY_AVATAR_${agent.toUpperCase()}`),
    video: (agent: string) => env(`MASKY_VIDEO_${agent.toUpperCase()}`),
    voice: (agent: string) => env(`MASKY_VOICE_${agent.toUpperCase()}`),
  },

  // Staff routes (doctor edit/approve etc.) require `authorization: Bearer <token>` when set.
  staffToken: env("CLINIC_STAFF_TOKEN"),
};

/** Throws a clear error when a required env var is missing. */
export function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
