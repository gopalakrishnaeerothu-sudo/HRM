import { updateEmployeeSchema } from "@/lib/validation/employee";
import { route } from "@/server/api/handler";
import { employeeService } from "@/server/services/employee-service";

type Params = { id: string };

/** GET /api/employees/:id */
export const GET = route<Params>({
  permission: "employee:read",
  handler: async ({ session, params }) => employeeService.detail(session, params.id),
});

/** PATCH /api/employees/:id */
export const PATCH = route<Params, typeof updateEmployeeSchema>({
  permission: "employee:update",
  schema: updateEmployeeSchema,
  handler: async ({ session, params, body }) => employeeService.update(session, params.id, body),
});

/** DELETE /api/employees/:id — soft delete; history is retained. */
export const DELETE = route<Params>({
  permission: "employee:delete",
  handler: async ({ session, params }) => employeeService.deactivate(session, params.id),
});
