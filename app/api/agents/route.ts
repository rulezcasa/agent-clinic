import { route } from "@/lib/http";
import { agentProfiles } from "@/lib/tools/masky";

/** Agent names, roles and faces (Masky avatar stills) for the front end. */
export const GET = route(async () => agentProfiles());
