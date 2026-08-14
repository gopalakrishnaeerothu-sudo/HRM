import { overrideAttendanceSchema } from "@/lib/validation/attendance";
import { route } from "@/server/api/handler";
import { attendanceService } from "@/server/services/attendance-service";

/**
 * POST /api/attendance/override
 *
 * HR/admin correction of an attendance record. Gated on
 * `attendance:override`, requires a written reason, marks the row
 * `isManualEntry`, and writes an ATTENDANCE_OVERRIDE audit entry naming the
 * actor and the before/after values.
 */
export const POST = route({
  permission: "attendance:override",
  schema: overrideAttendanceSchema,
  handler: async ({ session, body }) => attendanceService.override(session, body),
});
