import { updateTaskSchema } from "@/lib/validation/task";
import { route } from "@/server/api/handler";
import { taskService } from "@/server/services/task-service";

type Params = { id: string };

/** GET /api/tasks/:id */
export const GET = route<Params>({
  permission: "task:read",
  handler: async ({ session, params }) => taskService.detail(session, params.id),
});

/**
 * PATCH /api/tasks/:id
 *
 * Assignees and creators may edit their own tasks; anyone else needs
 * `task:update:any`. That distinction lives in the service, because the answer
 * depends on the row, not just the role.
 */
export const PATCH = route<Params, typeof updateTaskSchema>({
  permission: "task:read",
  schema: updateTaskSchema,
  handler: async ({ session, params, body }) => taskService.update(session, params.id, body),
});

/** DELETE /api/tasks/:id */
export const DELETE = route<Params>({
  permission: "task:delete",
  handler: async ({ session, params }) => taskService.remove(session, params.id),
});
