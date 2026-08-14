import { createTeamSchema } from "@/lib/validation/organization";
import { route } from "@/server/api/handler";
import { teamService } from "@/server/services/team-service";

/** GET /api/teams */
export const GET = route({
  permission: "team:read",
  handler: async ({ session }) => teamService.list(session),
});

/**
 * POST /api/teams
 *
 * Membership affects visibility — a manager can see the attendance of people
 * on teams they run — so this is gated on `team:manage` and audited.
 */
export const POST = route({
  permission: "team:manage",
  schema: createTeamSchema,
  handler: async ({ session, body }) => teamService.create(session, body),
});
