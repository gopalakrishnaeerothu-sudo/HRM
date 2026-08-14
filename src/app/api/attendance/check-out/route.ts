import { checkOutSchema } from "@/lib/validation/attendance";
import { clientMeta, route } from "@/server/api/handler";
import { attendanceService } from "@/server/services/attendance-service";

/** POST /api/attendance/check-out — closes the day and finalises totals. */
export const POST = route({
  permission: "attendance:check-in",
  schema: checkOutSchema,
  limit: "attendanceAction",
  handler: async ({ session, body, request }) => {
    const outcome = await attendanceService.checkOut(session, body.location, body.notes, {
      ...clientMeta(request),
      source: "WEB",
    });

    if (!outcome.ok) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json(
        {
          error: {
            code: "GEOFENCE_REJECTED",
            message: outcome.message,
            meta: {
              distanceMeters: outcome.verification.distanceMeters,
              requiredRadiusMeters: outcome.verification.requiredRadiusMeters,
            },
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    return { record: outcome.record, message: outcome.message };
  },
});
