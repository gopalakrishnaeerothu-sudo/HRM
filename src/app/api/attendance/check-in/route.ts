import { checkInSchema } from "@/lib/validation/attendance";
import { clientMeta, route } from "@/server/api/handler";
import { attendanceService } from "@/server/services/attendance-service";

/**
 * POST /api/attendance/check-in
 *
 * Body carries coordinates only. The office, the distance, whether the person
 * is inside the perimeter and whether they were late are all decided by the
 * server — see `attendanceService.checkIn`.
 *
 * A rejected check-in returns 403 with the distance and required radius in
 * `error.meta`, which is what the UI renders in its "outside the office"
 * panel. Both outcomes are written to `attendance_events`.
 */
export const POST = route({
  permission: "attendance:check-in",
  schema: checkInSchema,
  limit: "attendanceAction",
  handler: async ({ session, body, request }) => {
    const outcome = await attendanceService.checkIn(session, body.location, {
      ...clientMeta(request),
      source: "WEB",
    });

    if (!outcome.ok) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json(
        {
          error: {
            code:
              outcome.verification.verification === "OUTSIDE_GEOFENCE"
                ? "GEOFENCE_REJECTED"
                : "LOCATION_UNAVAILABLE",
            message: outcome.message,
            meta: {
              verification: outcome.verification.verification,
              distanceMeters: outcome.verification.distanceMeters,
              requiredRadiusMeters: outcome.verification.requiredRadiusMeters,
              officeName: outcome.verification.nearestZone?.officeName ?? null,
              riskFlags: outcome.verification.riskFlags,
            },
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    return {
      record: outcome.record,
      message: outcome.message,
      verification: {
        status: outcome.verification.verification,
        officeName: outcome.verification.nearestZone?.officeName ?? null,
        distanceMeters: outcome.verification.distanceMeters,
      },
    };
  },
});
