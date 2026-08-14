import { z } from "zod";

import { createSubtaskSchema } from "@/lib/validation/task";
import { route } from "@/server/api/handler";
import { taskService } from "@/server/services/task-service";

type Params = { id: string };

/** POST /api/tasks/:id/subtasks */
export const POST = route<Params, typeof createSubtaskSchema>({
  permission: "task:read",
  schema: createSubtaskSchema,
  handler: async ({ session, params, body }) => taskService.addSubtask(session, params.id, body.title),
});

const toggleSchema = z.object({
  subtaskId: z.string().uuid(),
  isCompleted: z.boolean(),
});

/** PATCH /api/tasks/:id/subtasks — tick or untick one subtask. */
export const PATCH = route<Params, typeof toggleSchema>({
  permission: "task:read",
  schema: toggleSchema,
  handler: async ({ session, params, body }) =>
    taskService.toggleSubtask(session, params.id, body.subtaskId, body.isCompleted),
});
