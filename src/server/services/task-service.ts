import "server-only";

import type { TaskActivityType } from "@/server/db/types";

import { errors } from "@/lib/errors";
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from "@/lib/validation/task";
import { STATUS_IMPLIED_PROGRESS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/validation/task";
import type { AuthSession } from "@/server/auth/types";
import { hasPermission } from "@/server/auth/permissions";
import {
  taskRepository,
  type TaskActivityEntry,
  type TaskDetail,
  type TaskSummary,
  type TaskUpdate,
} from "@/server/repositories/task-repository";
import { transaction } from "@/server/db/transaction";
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
): { taskId: string; actorId: string | null; type: TaskActivityType; message: string; fromValue: string | null; toValue: string | null } {
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

    // One transaction: a task whose assignees or opening timeline entry failed
    // to write is worse than no task at all, because it looks complete.
    const taskId = await transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, tx };

      // The repository allocates the per-tenant reference inside the INSERT
      // itself, so there is no read-then-write window for two creations to
      // land on the same number.
      const createdId = await taskRepository.create(txScope, {
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        creatorId,
        teamId: input.teamId ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        estimatedHours: input.estimatedHours ?? null,
        tags: input.tags,
        assigneeIds: input.assigneeIds,
        ownerId: input.ownerId ?? null,
      });

      await taskRepository.update(txScope, createdId, {
        progress,
        boardOrder: Date.now(),
      });

      await taskRepository.recordActivity(txScope, {
        ...activity(createdId, creatorId, "CREATED", `created this task`),
      });

      if (input.assigneeIds.length > 0) {
        await taskRepository.recordActivity(txScope, {
          ...activity(
            createdId,
            creatorId,
            "ASSIGNED",
            `assigned it to ${input.assigneeIds.length} ${input.assigneeIds.length === 1 ? "person" : "people"}`,
          ),
        });
      }

      return createdId;
    });

    const summary = await taskRepository.findById(scope, taskId);
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

    const data: TaskUpdate = {};
    const activities: TaskActivityEntry[] = [];

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
    if (input.teamId !== undefined) data.teamId = input.teamId ?? null;

    const newAssignees = input.assigneeIds;

    // One transaction: the field changes, the assignee swap and the timeline
    // entries describing both must land together, or the timeline ends up
    // claiming a change the task does not show.
    await transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, tx };

      // The team change is no longer a separate statement — the repository
      // takes team_id like any other column, which is what made Prisma need
      // two writes here.
      await taskRepository.update(txScope, taskId, data);

      if (newAssignees) {
        const previousIds = before.assignees.map((assignee) => assignee.employee.id).sort();
        const nextIds = [...newAssignees].sort();

        if (JSON.stringify(previousIds) !== JSON.stringify(nextIds)) {
          await taskRepository.replaceAssignees(
            txScope,
            taskId,
            newAssignees,
            input.ownerId ?? null,
          );
          activities.push(
            activity(taskId, actorEmployeeId, "ASSIGNED", `changed the assignees`),
          );
        }
      }

      for (const entry of activities) {
        await taskRepository.recordActivity(txScope, entry);
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

    const comment = await transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, tx };

      const created = await taskRepository.addComment(txScope, taskId, authorId, body);
      // Null means the task is not in this tenant. `detail` above already
      // proved otherwise, so this is a genuine failure rather than a 404.
      if (!created) throw errors.internal();

      await taskRepository.recordActivity(txScope, {
        ...activity(taskId, authorId, "COMMENTED", "added a comment"),
      });

      return created;
    });

    await notificationService.taskCommented(scope, task, authorId, session);
    return comment;
  },

  async addSubtask(session: AuthSession, taskId: string, title: string) {
    const scope = tenantScopeFor(session);
    await this.detail(session, taskId);

    // Position is allocated inside the INSERT, so two people adding a subtask
    // at the same moment cannot both claim the same slot — which the previous
    // count-then-insert allowed.
    const created = await transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, tx };

      const subtask = await taskRepository.addSubtask(txScope, taskId, title);
      if (!subtask) throw errors.internal();

      await taskRepository.recordActivity(txScope, {
        ...activity(taskId, session.employee?.id ?? null, "SUBTASK_ADDED", `added subtask “${title}”`),
      });

      return subtask;
    });

    return created;
  },

  async toggleSubtask(session: AuthSession, taskId: string, subtaskId: string, isCompleted: boolean) {
    const scope = tenantScopeFor(session);
    await this.detail(session, taskId);

    const updated = await taskRepository.setSubtaskCompletion(scope, subtaskId, isCompleted);
    if (!updated) throw errors.notFound("subtask");

    if (isCompleted) {
      await taskRepository.recordActivity(scope, {
        ...activity(taskId, session.employee?.id ?? null, "SUBTASK_COMPLETED", "completed a subtask"),
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
