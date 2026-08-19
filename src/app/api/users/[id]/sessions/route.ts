import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

type Params = { id: string };

/**
 * Sign an account out everywhere without changing its status.
 *
 * The remedy for a shared or stolen session when the account itself is fine —
 * disabling would also stop the person working, which is a different decision.
 */
export const DELETE = route<Params>({
  permission: "user:manage",
  handler: async ({ session, params }) => userAccessService.revokeSessions(session, params.id),
});
