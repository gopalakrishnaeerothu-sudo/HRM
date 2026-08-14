import { updateTeamSchema } from "@/lib/validation/organization";
import { route } from "@/server/api/handler";
import { teamService } from "@/server/services/team-service";

type Params = { id: string };

export const PATCH = route<Params, typeof updateTeamSchema>({
  permission: "team:manage",
  schema: updateTeamSchema,
  handler: async ({ session, params, body }) => teamService.update(session, params.id, body),
});

/** Refused while the team still has open tasks. */
export const DELETE = route<Params>({
  permission: "team:manage",
  handler: async ({ session, params }) => teamService.remove(session, params.id),
});
