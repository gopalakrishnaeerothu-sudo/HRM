import { z } from "zod";

import { prisma } from "@/lib/db";
import { parseQuery, route } from "@/server/api/handler";
import { resolveVisibleEmployeeIds, tenantScopeFor } from "@/server/services/access-service";

/**
 * GET /api/search?q=…
 *
 * Backs the ⌘K / Ctrl-K command palette. Tenant-scoped by construction, and
 * tasks are further narrowed to the caller's visibility envelope, so search is
 * not a way around the permissions applied to the list views.
 */

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

export const GET = route({
  handler: async ({ session, request }) => {
    const { q } = parseQuery(request, querySchema);
    const scope = tenantScopeFor(session);
    const envelope = await resolveVisibleEmployeeIds(session);
    const term = q;

    const [employees, tasks, teams, offices] = await Promise.all([
      prisma.employee.findMany({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { employeeCode: { contains: term, mode: "insensitive" } },
            { designation: { contains: term, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          avatarUrl: true,
        },
        take: 6,
      }),

      prisma.task.findMany({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          ...(envelope
            ? {
                OR: [
                  { assignees: { some: { employeeId: { in: [...envelope] } } } },
                  { creatorId: { in: [...envelope] } },
                ],
              }
            : {}),
          AND: [
            {
              OR: [
                { title: { contains: term, mode: "insensitive" } },
                { tags: { has: term.toLowerCase() } },
              ],
            },
          ],
        },
        select: { id: true, reference: true, title: true, status: true, priority: true },
        take: 6,
      }),

      prisma.team.findMany({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          name: { contains: term, mode: "insensitive" },
        },
        select: { id: true, name: true, color: true, _count: { select: { members: true } } },
        take: 4,
      }),

      prisma.office.findMany({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { city: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, city: true },
        take: 4,
      }),
    ]);

    return { employees, tasks, teams, offices };
  },
});
