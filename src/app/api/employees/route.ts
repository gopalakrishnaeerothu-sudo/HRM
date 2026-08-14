import { createEmployeeSchema, employeeQuerySchema } from "@/lib/validation/employee";
import { parseQuery, route } from "@/server/api/handler";
import { employeeService } from "@/server/services/employee-service";

/** GET /api/employees — paginated, filtered directory. */
export const GET = route({
  permission: "employee:read",
  handler: async ({ session, request }) => {
    const query = parseQuery(request, employeeQuerySchema);
    return employeeService.list(session, query);
  },
});

/** POST /api/employees — create an employee. HR and above. */
export const POST = route({
  permission: "employee:create",
  schema: createEmployeeSchema,
  handler: async ({ session, body }) => employeeService.create(session, body),
});
