import { createTaskSchema, taskQuerySchema } from "@/lib/validation/task";
import { parseQuery, route } from "@/server/api/handler";
import { taskService } from "@/server/services/task-service";

/**
 * GET /api/tasks
 *
 * `scope` is a *request*, not a grant: the service intersects it with the
 * caller's visibility envelope, so an employee asking for `scope=all` still
 * receives only their own tasks.
 */
export const GET = route({
  permission: "task:read",
  handler: async ({ session, request }) => {
    const query = parseQuery(request, taskQuerySchema);
    return taskService.list(session, query);
  },
});

/** POST /api/tasks */
export const POST = route({
  permission: "task:create",
  schema: createTaskSchema,
  handler: async ({ session, body }) => taskService.create(session, body),
});
