import { z } from "zod";

import { route } from "@/server/api/handler";
import { notificationService } from "@/server/services/notification-service";

/** GET /api/notifications — the caller's own in-app notifications. */
export const GET = route({
  handler: async ({ session }) => notificationService.listForSession(session),
});

const markSchema = z.object({
  /** Omit to mark every unread notification as read. */
  notificationId: z.string().uuid().optional(),
});

/** PATCH /api/notifications — mark one, or all, as read. */
export const PATCH = route<Record<string, never>, typeof markSchema>({
  schema: markSchema,
  handler: async ({ session, body }) => {
    if (body.notificationId) {
      const ok = await notificationService.markRead(session, body.notificationId);
      return { updated: ok ? 1 : 0 };
    }
    const count = await notificationService.markAllRead(session);
    return { updated: count };
  },
});
