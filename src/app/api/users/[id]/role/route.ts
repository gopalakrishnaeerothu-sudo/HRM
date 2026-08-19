import { changeRoleSchema } from "@/lib/validation/auth";
import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

type Params = { id: string };

/**
 * Change an account's role.
 *
 * Requires `user:role:assign`, and is additionally bounded per-caller: the
 * service checks the caller outranks both the role the target holds now and
 * the role being granted. There is no request shape that promotes anyone to
 * OWNER, and none that lets a caller re-role themselves.
 */
export const PATCH = route<Params, typeof changeRoleSchema>({
  permission: "user:role:assign",
  schema: changeRoleSchema,
  handler: async ({ session, params, body }) =>
    userAccessService.changeRole(session, params.id, body),
});
