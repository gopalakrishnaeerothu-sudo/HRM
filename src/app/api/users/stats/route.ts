import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

/** The header tiles and the pending-request badge. */
export const GET = route({
  permission: "user:read",
  handler: async ({ session }) => userAccessService.stats(session),
});
