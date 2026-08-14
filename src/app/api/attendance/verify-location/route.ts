import { z } from "zod";

import { locationClaimSchema } from "@/lib/validation/common";
import { route } from "@/server/api/handler";
import { attendanceService } from "@/server/services/attendance-service";

/**
 * POST /api/attendance/verify-location
 *
 * Read-only geofence evaluation, used by the check-in panel to show live
 * "inside / outside the office" state before the employee commits.
 *
 * It exists so the browser never has to compute that verdict itself: the
 * indicator the employee sees is the same decision the server would make. It
 * records nothing, and it reveals only the employee's own distance to their
 * own assigned offices.
 */
export const POST = route({
  permission: "attendance:check-in",
  schema: z.object({ location: locationClaimSchema }),
  limit: "attendanceAction",
  handler: async ({ session, body }) => {
    const result = await attendanceService.previewLocation(session, body.location);

    return {
      allowed: result.allowed,
      verification: result.verification,
      message: result.message,
      officeName: result.nearestZone?.officeName ?? null,
      distanceMeters: result.distanceMeters,
      requiredRadiusMeters: result.requiredRadiusMeters,
      riskFlags: result.riskFlags,
    };
  },
});
