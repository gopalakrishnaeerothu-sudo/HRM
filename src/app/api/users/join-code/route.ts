import { z } from "zod";

import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

const rotateSchema = z.object({ enabled: z.boolean() });

/** The organisation's current signup code, for the administrator to share. */
export const GET = route({
  permission: "user:manage",
  handler: async ({ session }) => userAccessService.joinCode(session),
});

/**
 * Issue a new code, or turn self-signup off entirely.
 *
 * `settings:manage` rather than `user:manage`: this is not a decision about one
 * account, it opens or closes the front door for the whole organisation, which
 * puts it alongside the other tenant-wide settings and out of HR's reach.
 */
export const PUT = route<Record<string, never>, typeof rotateSchema>({
  permission: "settings:manage",
  schema: rotateSchema,
  handler: async ({ session, body }) => userAccessService.rotateJoinCode(session, body),
});
