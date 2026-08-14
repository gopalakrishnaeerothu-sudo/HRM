import { z } from "zod";

import {
  attendancePolicySchema,
  organizationProfileSchema,
  workingHoursSchema,
} from "@/lib/validation/organization";
import { route } from "@/server/api/handler";
import { settingsService } from "@/server/services/settings-service";

/**
 * PATCH /api/settings
 *
 * One endpoint, three discriminated sections — so a form that edits working
 * hours cannot accidentally submit a geofence-enforcement change it never
 * showed the user. Each section is validated by its own schema.
 */
const settingsSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("profile"), values: organizationProfileSchema }),
  z.object({ section: z.literal("workingHours"), values: workingHoursSchema }),
  z.object({ section: z.literal("attendancePolicy"), values: attendancePolicySchema }),
]);

export const PATCH = route<Record<string, never>, typeof settingsSchema>({
  permission: "settings:manage",
  schema: settingsSchema,
  handler: async ({ session, body }) => {
    switch (body.section) {
      case "profile":
        return settingsService.updateProfile(session, body.values);
      case "workingHours":
        return settingsService.updateWorkingHours(session, body.values);
      case "attendancePolicy":
        return settingsService.updateAttendancePolicy(session, body.values);
    }
  },
});
