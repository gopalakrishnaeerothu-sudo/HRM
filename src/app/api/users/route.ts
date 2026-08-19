import { accessQuerySchema, inviteUserSchema } from "@/lib/validation/auth";
import { parseQuery, route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

/**
 * The access table.
 *
 * `user:read` is held by HR and above, so an employee listing their colleagues'
 * account states is refused here rather than filtered — this endpoint is about
 * access, not the staff directory, which is `/api/employees`.
 */
export const GET = route({
  permission: "user:read",
  handler: async ({ session, request }) =>
    userAccessService.list(session, parseQuery(request, accessQuerySchema)),
});

/** Create an account directly, without it passing through the queue. */
export const POST = route<Record<string, never>, typeof inviteUserSchema>({
  permission: "user:invite",
  schema: inviteUserSchema,
  handler: async ({ session, body }) => userAccessService.invite(session, body),
});
