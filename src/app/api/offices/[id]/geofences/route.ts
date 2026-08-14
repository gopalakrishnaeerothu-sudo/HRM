import { z } from "zod";

import { upsertGeofenceSchema } from "@/lib/validation/office";
import { route } from "@/server/api/handler";
import { officeService } from "@/server/services/office-service";

type Params = { id: string };

/**
 * PUT /api/offices/:id/geofences
 *
 * Creates or replaces a zone. Gated on `geofence:manage` rather than the
 * broader `office:manage`, and audited as GEOFENCE_CHANGE — widening a radius
 * changes who can record attendance, so it is treated as an access-control
 * change, not a cosmetic edit.
 */
export const PUT = route<Params, typeof upsertGeofenceSchema>({
  permission: "geofence:manage",
  schema: upsertGeofenceSchema,
  handler: async ({ session, params, body }) => officeService.upsertGeofence(session, params.id, body),
});

const deleteSchema = z.object({ geofenceId: z.string().uuid() });

/** DELETE /api/offices/:id/geofences — refuses to remove the last active zone. */
export const DELETE = route<Params, typeof deleteSchema>({
  permission: "geofence:manage",
  schema: deleteSchema,
  handler: async ({ session, params, body }) =>
    officeService.removeGeofence(session, params.id, body.geofenceId),
});
