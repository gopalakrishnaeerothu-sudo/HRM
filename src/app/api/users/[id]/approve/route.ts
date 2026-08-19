import { approveUserSchema } from "@/lib/validation/auth";
import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

type Params = { id: string };

/**
 * Approve a pending request and set the role it lands on.
 *
 * The role arrives in the body, but which roles this caller may actually grant
 * is decided server-side from the session — see `canAssignRole`. A body
 * claiming OWNER is refused regardless of who sends it.
 */
export const POST = route<Params, typeof approveUserSchema>({
  permission: "user:approve",
  schema: approveUserSchema,
  handler: async ({ session, params, body }) =>
    userAccessService.approve(session, params.id, body),
});
