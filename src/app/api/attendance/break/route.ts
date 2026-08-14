import { breakSchema } from "@/lib/validation/attendance";
import { route } from "@/server/api/handler";
import { attendanceService } from "@/server/services/attendance-service";

/** POST /api/attendance/break — start or end a break. */
export const POST = route({
  permission: "attendance:check-in",
  schema: breakSchema,
  limit: "attendanceAction",
  handler: async ({ session, body }) => attendanceService.toggleBreak(session, body.action, body.reason),
});
