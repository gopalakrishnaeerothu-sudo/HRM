import { createCommentSchema } from "@/lib/validation/task";
import { route } from "@/server/api/handler";
import { taskService } from "@/server/services/task-service";

type Params = { id: string };

/** POST /api/tasks/:id/comments */
export const POST = route<Params, typeof createCommentSchema>({
  permission: "task:read",
  schema: createCommentSchema,
  handler: async ({ session, params, body }) => taskService.addComment(session, params.id, body.body),
});
