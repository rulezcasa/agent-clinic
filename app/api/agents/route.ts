import { route } from "@/lib/http";
import { agentProfiles } from "@/lib/tools/masky";

/** Agent faces/voices (Masky) for the chat page and staff timeline. */
export const GET = route(async () => agentProfiles());
