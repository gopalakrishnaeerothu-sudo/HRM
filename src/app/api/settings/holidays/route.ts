import { z } from "zod";

import { holidaySchema } from "@/lib/validation/organization";
import { route } from "@/server/api/handler";
import { settingsService } from "@/server/services/settings-service";

/** POST /api/settings/holidays — add a company holiday. */
export const POST = route<Record<string, never>, typeof holidaySchema>({
  permission: "settings:manage",
  schema: holidaySchema,
  handler: async ({ session, body }) =>
    settingsService.addHoliday(session, {
      name: body.name,
      date: body.date,
      isOptional: body.isOptional,
    }),
});

const deleteSchema = z.object({ holidayId: z.string().uuid() });

/** DELETE /api/settings/holidays */
export const DELETE = route<Record<string, never>, typeof deleteSchema>({
  permission: "settings:manage",
  schema: deleteSchema,
  handler: async ({ session, body }) => settingsService.removeHoliday(session, body.holidayId),
});
