import { rejectUserSchema } from "@/lib/validation/auth";
import { route } from "@/server/api/handler";
import { userAccessService } from "@/server/services/user-access-service";

type Params = { id: string };

export const POST = route<Params, typeof rejectUserSchema>({
  permission: "user:approve",
  schema: rejectUserSchema,
  handler: async ({ session, params, body }) =>
    userAccessService.reject(session, params.id, body),
});
