import { reviewLeaveSchema } from "@/lib/validation/attendance";
import { route } from "@/server/api/handler";
import { leaveService } from "@/server/services/leave-service";

type Params = { id: string };

/**
 * PATCH /api/leave/:id — approve or decline.
 *
 * Gated on `leave:approve`, and the service additionally refuses when the
 * reviewer is the requester or when the requester is outside the reviewer's
 * visibility envelope. Writes an audit entry either way.
 */
export const PATCH = route<Params, typeof reviewLeaveSchema>({
  permission: "leave:approve",
  schema: reviewLeaveSchema,
  handler: async ({ session, params, body }) => leaveService.review(session, params.id, body),
});

/** DELETE /api/leave/:id — the requester withdraws their own pending request. */
export const DELETE = route<Params>({
  permission: "leave:request",
  handler: async ({ session, params }) => leaveService.cancel(session, params.id),
});
