import { createOfficeSchema } from "@/lib/validation/office";
import { route } from "@/server/api/handler";
import { officeService } from "@/server/services/office-service";

/** GET /api/offices — every office in the tenant, with its active zones. */
export const GET = route({
  permission: "office:read",
  handler: async ({ session }) => officeService.list(session),
});

/**
 * POST /api/offices
 *
 * Coordinates and radius come from the administrator creating the office;
 * nothing is hard-coded. A primary geofence is created alongside the office so
 * it can never exist without one.
 */
export const POST = route({
  permission: "office:manage",
  schema: createOfficeSchema,
  handler: async ({ session, body }) => officeService.create(session, body),
});
