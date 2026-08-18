import "server-only";

import type { Prisma } from "@prisma/client";

import type { TaskActivityType } from "@/server/db/types";

import { prisma } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from "@/lib/validation/task";
import { STATUS_IMPLIED_PROGRESS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/validation/task";
import type { AuthSession } from "@/server/auth/types";
import { hasPermission } from "@/server/auth/permissions";
import { taskRepository, type TaskDetail, type TaskSummary } from "@/server/repositories/task-repository";
import { assertBelongsToTenant, type TenantScope } from "@/server/db/tenant";
import { resolveVisibleEmployeeIds, tenantScopeFor } from "@/server/services/access-service";
import { notificationService } from "@/server/services/notification-service";

/**
 * Task orchestration: authorisation envelope, status/progress consistency, and
 * the activity timeline that makes task history auditable.
 */

/** Which employees' tasks this session may see. `null` = the whole tenant. */
async function envelopeFor(session: AuthSession, scope: TaskQuery["scope"]) {
  const base = await resolveVisibleEmployeeIds(session);

  if (scope === "mine" || scope === "created") {
    // Explicitly self-scoped, but still intersected with the envelope so it
    // can never widen access for an account with no employee profile.
    return session.employee ? [session.employee.id] : [];
  }
  return base;
}

function activity(
  taskId: string,
  actorId: string | null,
  type: TaskActivityType,
  message: string,
  fromValue?: string | null,
  toValue?: string | null,
): Omit<Prisma.TaskActivityUncheckedCreateInput, "organizationId"> {
  return { taskId, actorId, type, message, fromValue: fromValue ?? null, toValue: toValue ?? null };
}

export const taskService = {
  async list(session: AuthSession, query: TaskQuery) {
    const scope = tenantScopeFor(session);
    const envelope = await envelopeFor(session, query.scope);

    // "created" filters by creator rather than assignment.
    const effectiveQuery: TaskQuery =
      query.scope === "created" && session.employee
        ? { ...query, creatorId: session.employee.id }
        : query;

    return taskRepository.list(scope, effectiveQuery, envelope);
  },

  async board(session: AuthSession, query: Partial<TaskQuery>) {
    const scope = tenantScopeFor(session);
    const envelope = await envelopeFor(session, query.scope ?? "all");
    return taskRepository.listForBoard(scope, query, envelope);
  },

  async detail(session: AuthSession, taskId: string): Promise<TaskDetail> {
    const scope = tenantScopeFor(session);
    const task = await taskRepository.findById(scope, taskId);
    if (!task) throw errors.notFound("task");

    // Visibility check: a task is readable if the caller can see anyone
    // attached to it, or holds an org-wide read permission.
    const envelope = await resolveVisibleEmployeeIds(session);
    if (envelope !== null) {
      const participants = new Set<string>([
        ...task.assignees.map((assignee) => assignee.employee.id),
        ...(task.creator ? [task.creator.id] : []),
      ]);
      const overlap = envelope.some((id) => participants.has(id));
      if (!overlap) throw errors.notFound("task");
    }

    return task;
  },

  async create(session: AuthSession, input: CreateTaskInput): Promise<TaskSummary> {
    const scope = tenantScopeFor(session);
    const creatorId = session.employee?.id ?? null;

    // Every referenced id is confirmed to live in this tenant before it is
    // written as a foreign key.
    await assertBelongsToTenant(scope, {
      employeeIds: input.assigneeIds,
      teamIds: input.teamId ? [input.teamId] : [],
    });

    const progress = input.progress || (STATUS_IMPLIED_PROGRESS[input.status] ?? 0);

    const task = await prisma.$transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, db: tx };
      const reference = await taskRepository.nextReference(txScope);

      const created = await tx.task.create({
        data: {
          organizationId: scope.organizationId,
          reference,
          title: input.title,
          description: input.description ?? null,
          status: input.status,
          priority: input.priority,
          creatorId,
          teamId: input.teamId ?? null,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimatedHours: input.estimatedHours ?? null,
          progress,
          tags: input.tags,
          boardOrder: Date.now(),
          completedAt: input.status === "COMPLETED" ? new Date() : null,
          assignees: {
            create: input.assigneeIds.map((employeeId) => ({
              employeeId,
              isOwner: employeeId === input.ownerId,
            })),
          },
        },
        select: { id: true },
      });

      await tx.taskActivity.create({
        data: {
          organizationId: scope.organizationId,
          ...activity(created.id, creatorId, "CREATED", `created this task`),
        },
      });

      if (input.assigneeIds.length > 0) {
        await tx.taskActivity.create({
          data: {
            organizationId: scope.organizationId,
            ...activity(
              created.id,
              creatorId,
              "ASSIGNED",
              `assigned it to ${input.assigneeIds.length} ${input.assigneeIds.length === 1 ? "person" : "people"}`,
            ),
          },
        });
      }

      return created;
    });

    const summary = await taskRepository.findById(scope, task.id);
    if (!summary) throw errors.internal();

    await notificationService.taskAssigned(scope, summary, input.assigneeIds, session);
    return summary;
  },

  /**
   * Partial update with an activity entry per changed field.
   *
   * Permission model: an assignee or the creator may update their own task;
   * anything else needs `task:update:any`.
   */
  async update(session: AuthSession, taskId: string, input: UpdateTaskInput): Promise<TaskDetail> {
    const scope = tenantScopeFor(session);
    const before = await this.detail(session, taskId);

    const actorEmployeeId = session.employee?.id ?? null;
    const isParticipant =
      actorEmployeeId !== null &&
      (before.creator?.id === actorEmployeeId ||
        before.assignees.some((assignee) => assignee.employee.id === actorEmployeeId));

    if (!isParticipant && !hasPermission(session.user.role, "task:update:any", session.permissionOverrides)) {
      throw errors.forbidden("You can only edit tasks you're assigned to or created.");
    }

    if (input.assigneeIds || input.teamId) {
      await assertBelongsToTenant(scope, {
        employeeIds: input.assigneeIds ?? [],
        teamIds: input.teamId ? [input.teamId] : [],
      });
    }

    const data: Prisma.TaskUpdateInput = {};
    const activities: Array<Omit<Prisma.TaskActivityUncheckedCreateInput, "organizationId">> = [];

    if (input.title !== undefined && input.title !== before.title) {
      data.title = input.title;
      activities.push(activity(taskId, actorEmployeeId, "UPDATED", "renamed the task", before.title, input.title));
    }

    if (input.description !== undefined) data.description = input.description ?? null;

    if (input.status !== undefined && input.status !== before.status) {
      data.status = input.status;
      data.completedAt = input.status === "COMPLETED" ? new Date() : null;

      // Keep progress consistent with status unless the caller set it too.
      const implied = STATUS_IMPLIED_PROGRESS[input.status];
      if (implied !== null && input.progress === undefined) data.progress = implied;

      activities.push(
        activity(
          taskId,
          actorEmployeeId,
          input.status === "COMPLETED" ? "COMPLETED" : "STATUS_CHANGED",
          input.status === "COMPLETED"
            ? "completed this task"
            : `moved it to ${TASK_STATUS_LABELS[input.status]}`,
          TASK_STATUS_LABELS[before.status],
          TASK_STATUS_LABELS[input.status],
        ),
      );
    }

    if (input.priority !== undefined && input.priority !== before.priority) {
      data.priority = input.priority;
      activities.push(
        activity(
          taskId,
          actorEmployeeId,
          "PRIORITY_CHANGED",
          `changed priority to ${TASK_PRIORITY_LABELS[input.priority]}`,
          TASK_PRIORITY_LABELS[before.priority],
          TASK_PRIORITY_LABELS[input.priority],
        ),
      );
    }

    if (input.progress !== undefined && input.progress !== before.progress) {
      data.progress = input.progress;
      activities.push(
        activity(
          taskId,
          actorEmployeeId,
          "PROGRESS_UPDATED",
          `updated progress to ${input.progress}%`,
          `${before.progress}%`,
          `${input.progress}%`,
        ),
      );
    }

    if (input.dueDate !== undefined) {
      data.dueDate = input.dueDate ?? null;
      activities.push(
        activity(
          taskId,
          actorEmployeeId,
          "DUE_DATE_CHANGED",
          input.dueDate ? `set the due date` : "cleared the due date",
          before.dueDate?.toISOString() ?? null,
          input.dueDate?.toISOString() ?? null,
        ),
      );
    }

    if (input.startDate !== undefined) data.startDate = input.startDate ?? null;
    if (input.estimatedHours !== undefined) data.estimatedHours = input.estimatedHours ?? null;
    if (input.actualHours !== undefined) data.actualHours = input.actualHours;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.boardOrder !== undefined) data.boardOrder = input.boardOrder;
    if (input.teamId !== undefined) {
      data.team = input.teamId ? { connect: { id: input.teamId } } : { disconnect: true };
    }

    const newAssignees = input.assigneeIds;

    await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({
        where: { id: taskId, organizationId: scope.organizationId, deletedAt: null },
        data: data as Prisma.TaskUpdateManyMutationInput,
      });

      // team/relation updates cannot go through updateMany, so apply separately.
      if (input.teamId !== undefined) {
        await tx.task.update({ where: { id: taskId }, data: { teamId: input.teamId ?? null } });
      }

      if (newAssignees) {
        const previousIds = before.assignees.map((assignee) => assignee.employee.id).sort();
        const nextIds = [...newAssignees].sort();

        if (JSON.stringify(previousIds) !== JSON.stringify(nextIds)) {
          await tx.taskAssignee.deleteMany({ where: { taskId } });
          if (newAssignees.length > 0) {
            await tx.taskAssignee.createMany({
              data: newAssignees.map((employeeId) => ({
                taskId,
                employeeId,
                isOwner: employeeId === input.ownerId,
              })),
              skipDuplicates: true,
            });
          }
          activities.push(
            activity(taskId, actorEmployeeId, "ASSIGNED", `changed the assignees`),
          );
        }
      }

      if (activities.length > 0) {
        await tx.taskActivity.createMany({
          data: activities.map((entry) => ({ ...entry, organizationId: scope.organizationId })),
        });
      }
    });

    const updated = await taskRepository.findById(scope, taskId);
    if (!updated) throw errors.notFound("task");

    if (newAssignees) {
      const previous = new Set(before.assignees.map((assignee) => assignee.employee.id));
      const added = newAssignees.filter((id) => !previous.has(id));
      if (added.length > 0) await notificationService.taskAssigned(scope, updated, added, session);
    }

    return updated;
  },

  async addComment(session: AuthSession, taskId: string, body: string) {
    const scope = tenantScopeFor(session);
    const task = await this.detail(session, taskId);
    const authorId = session.employee?.id ?? null;

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskComment.create({
        data: { organizationId: scope.organizationId, taskId, authorId, body },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      });

      await tx.taskActivity.create({
        data: {
          organizationId: scope.organizationId,
          ...activity(taskId, authorId, "COMMENTED", "added a comment"),
        },
      });

      return created;
    });

    await notificationService.taskCommented(scope, task, authorId, session);
    return comment;
  },

  async addSubtask(session: AuthSession, taskId: string, title: string) {
    const scope = tenantScopeFor(session);
    await this.detail(session, taskId);

    const position = await prisma.subtask.count({ where: { taskId } });
    const created = await prisma.subtask.create({ data: { taskId, title, position } });

    await prisma.taskActivity.create({
      data: {
        organizationId: scope.organizationId,
        ...activity(taskId, session.employee?.id ?? null, "SUBTASK_ADDED", `added subtask “${title}”`),
      },
    });

    return created;
  },

  async toggleSubtask(session: AuthSession, taskId: string, subtaskId: string, isCompleted: boolean) {
    const scope = tenantScopeFor(session);
    await this.detail(session, taskId);

    const result = await prisma.subtask.updateMany({
      where: { id: subtaskId, taskId },
      data: { isCompleted, completedAt: isCompleted ? new Date() : null },
    });
    if (result.count === 0) throw errors.notFound("subtask");

    if (isCompleted) {
      await prisma.taskActivity.create({
        data: {
          organizationId: scope.organizationId,
          ...activity(taskId, session.employee?.id ?? null, "SUBTASK_COMPLETED", "completed a subtask"),
        },
      });
    }

    return { id: subtaskId, isCompleted };
  },

  async remove(session: AuthSession, taskId: string) {
    const scope = tenantScopeFor(session);
    await this.detail(session, taskId);
    const removed = await taskRepository.softDelete(scope, taskId);
    if (!removed) throw errors.notFound("task");
    return { id: taskId };
  },
};
