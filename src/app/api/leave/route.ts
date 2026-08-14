import { requestLeaveSchema } from "@/lib/validation/attendance";
import { route } from "@/server/api/handler";
import { leaveService } from "@/server/services/leave-service";

/** GET /api/leave — the caller's own requests plus their balances. */
export const GET = route({
  permission: "leave:request",
  handler: async ({ session }) => {
    const [requests, balances] = await Promise.all([
      leaveService.listMine(session),
      leaveService.balances(session),
    ]);
    return { requests, balances };
  },
});

/** POST /api/leave — submit a request. Rejected if it overlaps an existing one. */
export const POST = route({
  permission: "leave:request",
  schema: requestLeaveSchema,
  handler: async ({ session, body }) => leaveService.request(session, body),
});
