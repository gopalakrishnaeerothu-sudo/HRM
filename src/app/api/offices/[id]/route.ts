import { updateOfficeSchema } from "@/lib/validation/office";
import { route } from "@/server/api/handler";
import { officeService } from "@/server/services/office-service";

type Params = { id: string };

export const GET = route<Params>({
  permission: "office:read",
  handler: async ({ session, params }) => officeService.detail(session, params.id),
});

export const PATCH = route<Params, typeof updateOfficeSchema>({
  permission: "office:manage",
  schema: updateOfficeSchema,
  handler: async ({ session, params, body }) => officeService.update(session, params.id, body),
});

/** Refused while employees are still assigned to the office. */
export const DELETE = route<Params>({
  permission: "office:manage",
  handler: async ({ session, params }) => officeService.deactivate(session, params.id),
});
