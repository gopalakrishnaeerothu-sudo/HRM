import "server-only";

import type { z } from "zod";

import { prisma } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { createTeamSchema, updateTeamSchema } from "@/lib/validation/organization";
import type { AuthSession } from "@/server/auth/types";
import { teamRepository } from "@/server/repositories/org-repository";
import { assertBelongsToTenant } from "@/server/db/tenant";
import { auditService, diff } from "@/server/services/audit-service";
import { tenantScopeFor } from "@/server/services/access-service";

type CreateInput = z.infer<typeof createTeamSchema>;
type UpdateInput = z.infer<typeof updateTeamSchema>;

/**
 * Team management.
 *
 * Team membership is not cosmetic: a MANAGER's visibility envelope includes
 * the members of teams they manage, so adding someone to a team a manager runs
 * grants that manager sight of their attendance and tasks. Changes are audited
 * for that reason.
 */
export const teamService = {
  async list(session: AuthSession) {
    return teamRepository.list(tenantScopeFor(session));
  },

  async create(session: AuthSession, input: CreateInput) {
    const scope = tenantScopeFor(session);

    await assertBelongsToTenant(scope, {
      employeeIds: [...(input.memberIds ?? []), ...(input.managerId ? [input.managerId] : [])],
      departmentIds: input.departmentId ? [input.departmentId] : [],
    });

    const slug = slugify(input.name);
    if (await isSlugTaken(scope.organizationId, slug)) {
      throw errors.validation("A team with that name already exists.", {
        name: ["Already used by another team"],
      });
    }

    const team = await teamRepository.create(scope, {
      name: input.name,
      slug,
      description: input.description ?? null,
      color: input.color,
      departmentId: input.departmentId ?? null,
      managerId: input.managerId ?? null,
    });

    if (input.memberIds?.length) {
      await teamRepository.replaceMembers(scope, team.id, input.memberIds);
    }

    await auditService.record(scope, session, {
      action: "CREATE",
      entityType: "teams",
      entityId: team.id,
      summary: `Created team "${input.name}" with ${input.memberIds?.length ?? 0} members`,
    });

    return team;
  },

  async update(session: AuthSession, teamId: string, input: UpdateInput) {
    const scope = tenantScopeFor(session);
    const before = await teamRepository.requireById(scope, teamId);

    await assertBelongsToTenant(scope, {
      employeeIds: [...(input.memberIds ?? []), ...(input.managerId ? [input.managerId] : [])],
      departmentIds: input.departmentId ? [input.departmentId] : [],
    });

    await teamRepository.update(scope, teamId, {
      ...(input.name !== undefined ? { name: input.name, slug: slugify(input.name) } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId ?? null } : {}),
    });

    if (input.memberIds) {
      await teamRepository.replaceMembers(scope, teamId, input.memberIds);
    }

    const after = await teamRepository.requireById(scope, teamId);

    await auditService.record(scope, session, {
      action: "UPDATE",
      entityType: "teams",
      entityId: teamId,
      summary: `Updated team "${after.name}"`,
      changes: diff(
        {
          name: before.name,
          managerId: before.manager?.id ?? null,
          memberCount: before.counts.members,
        },
        {
          name: after.name,
          managerId: after.manager?.id ?? null,
          memberCount: after.counts.members,
        },
      ),
    });

    return after;
  },

  async remove(session: AuthSession, teamId: string) {
    const scope = tenantScopeFor(session);
    const team = await teamRepository.requireById(scope, teamId);

    const openTasks = await prisma.task.count({
      where: { organizationId: scope.organizationId, teamId, deletedAt: null, status: { not: "COMPLETED" } },
    });
    if (openTasks > 0) {
      throw errors.precondition(
        `${team.name} still has ${openTasks} open ${openTasks === 1 ? "task" : "tasks"}. Reassign or close them first.`,
      );
    }

    await teamRepository.softDelete(scope, teamId);

    await auditService.record(scope, session, {
      action: "DELETE",
      entityType: "teams",
      entityId: teamId,
      summary: `Deleted team "${team.name}"`,
    });

    return { id: teamId };
  },
};

/** "Frontend Team" → "frontend-team" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function isSlugTaken(organizationId: string, slug: string): Promise<boolean> {
  const found = await prisma.team.findFirst({
    where: { organizationId, slug },
    select: { id: true },
  });
  return found !== null;
}
