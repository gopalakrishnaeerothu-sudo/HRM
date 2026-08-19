import { setAccessStatusSchema } from "@/lib/validation/auth";
import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

type Params = { id: string };

/**
 * Enable, disable, lock or unlock an account.
 *
 * PENDING and REJECTED are not reachable through here — the schema does not
 * accept them, and the service refuses a target still sitting in the queue.
 * Deciding a request has to go through approve/reject so the role is chosen
 * and the decision is audited as a decision.
 */
export const PATCH = route<Params, typeof setAccessStatusSchema>({
  permission: "user:manage",
  schema: setAccessStatusSchema,
  handler: async ({ session, params, body }) =>
    userAccessService.setStatus(session, params.id, body),
});
