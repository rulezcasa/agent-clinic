import { route } from "@/lib/http";
import { getFreeSlots } from "@/lib/tools/calcom";

export const GET = route(async () => getFreeSlots());
