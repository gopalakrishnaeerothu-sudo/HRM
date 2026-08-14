import "server-only";

import type { Prisma } from "@prisma/client";

import type { TaskQuery } from "@/lib/validation/task";
import {
  client,
  liveTenantWhere,
  paginate,
  skipTake,
  type Paginated,
  type TenantScope,
} from "@/server/repositories/tenant";

export const taskSummarySelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  priority: true,
  progress: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  estimatedHours: true,
  actualHours: true,
  tags: true,
  boardOrder: true,
  createdAt: true,
  updatedAt: true,
  team: { select: { id: true, name: true, color: true } },
  creator: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  assignees: {
    select: {
      isOwner: true,
      employee: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: true },
      },
    },
    orderBy: { isOwner: "desc" },
  },
  _count: { select: { comments: true, attachments: true, subtasks: true } },
} satisfies Prisma.TaskSelect;

export type TaskSummary = Prisma.TaskGetPayload<{ select: typeof taskSummarySelect }>;

const taskDetailSelect = {
  ...taskSummarySelect,
  description: true,
  subtasks: {
    select: { id: true, title: true, isCompleted: true, completedAt: true, position: true },
    orderBy: { position: "asc" },
  },
  comments: {
    where: { deletedAt: null },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      storageKey: true,
      createdAt: true,
      uploader: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  activities: {
    select: {
      id: true,
      type: true,
      message: true,
      fromValue: true,
      toValue: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  },
} satisfies Prisma.TaskSelect;

export type TaskDetail = Prisma.TaskGetPayload<{ select: typeof taskDetailSelect }>;

/**
 * Build the `where` clause.
 *
 * `visibleToEmployeeIds` is the caller's authorisation envelope, resolved from
 * the session by the task service. It is intersected with the user's filters,
 * so a filter can only ever narrow what they may see, never widen it.
 */
export function buildTaskWhere(
  scope: TenantScope,
  query: Partial<TaskQuery>,
  visibleToEmployeeIds: readonly string[] | null,
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { ...liveTenantWhere(scope) };
  const and: Prisma.TaskWhereInput[] = [];

  if (visibleToEmployeeIds) {
    and.push({
      OR: [
        { assignees: { some: { employeeId: { in: [...visibleToEmployeeIds] } } } },
        { creatorId: { in: [...visibleToEmployeeIds] } },
      ],
    });
  }

  if (query.status) {
    where.status = Array.isArray(query.status) ? { in: query.status } : query.status;
  }
  if (query.priority) {
    where.priority = Array.isArray(query.priority) ? { in: query.priority } : query.priority;
  }
  if (query.teamId) where.teamId = query.teamId;
  if (query.creatorId) where.creatorId = query.creatorId;
  if (query.assigneeId) {
    and.push({ assignees: { some: { employeeId: query.assigneeId } } });
  }

  if (query.overdue) {
    and.push({ dueDate: { lt: new Date() }, status: { notIn: ["COMPLETED"] } });
  }
  if (query.dueBefore) and.push({ dueDate: { lte: query.dueBefore } });
  if (query.dueAfter) and.push({ dueDate: { gte: query.dueAfter } });

  if (query.search) {
    const term = query.search;
    // Reference lookup: "TF-118" or "118" both find task #118.
    const numeric = Number(term.replace(/\D/g, ""));
    and.push({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { tags: { has: term.toLowerCase() } },
        ...(Number.isFinite(numeric) && numeric > 0 ? [{ reference: numeric }] : []),
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

function buildOrderBy(query: Partial<TaskQuery>): Prisma.TaskOrderByWithRelationInput[] {
  const direction = query.sortOrder ?? "asc";
  switch (query.sortBy) {
    case "priority":
      // Enum order in the schema is LOW→URGENT, so "desc" puts URGENT first.
      return [{ priority: direction === "asc" ? "desc" : "asc" }, { dueDate: "asc" }];
    case "createdAt":
      return [{ createdAt: direction }];
    case "title":
      return [{ title: direction }];
    case "status":
      return [{ status: direction }, { boardOrder: "asc" }];
    default:
      // Tasks with no due date sort last rather than first.
      return [{ dueDate: { sort: direction, nulls: "last" } }, { priority: "desc" }];
  }
}

export const taskRepository = {
  async list(
    scope: TenantScope,
    query: TaskQuery,
    visibleToEmployeeIds: readonly string[] | null,
  ): Promise<Paginated<TaskSummary>> {
    const db = client(scope);
    const where = buildTaskWhere(scope, query, visibleToEmployeeIds);

    const [items, total] = await Promise.all([
      db.task.findMany({
        where,
        select: taskSummarySelect,
        orderBy: buildOrderBy(query),
        ...skipTake(query.page, query.pageSize),
      }),
      db.task.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  },

  /** Board view: unpaginated but hard-capped so a huge backlog cannot OOM. */
  async listForBoard(
    scope: TenantScope,
    query: Partial<TaskQuery>,
    visibleToEmployeeIds: readonly string[] | null,
    limit = 300,
  ): Promise<TaskSummary[]> {
    return client(scope).task.findMany({
      where: buildTaskWhere(scope, query, visibleToEmployeeIds),
      select: taskSummarySelect,
      orderBy: [{ status: "asc" }, { boardOrder: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
  },

  async findById(scope: TenantScope, id: string): Promise<TaskDetail | null> {
    return client(scope).task.findFirst({
      where: { id, ...liveTenantWhere(scope) },
      select: taskDetailSelect,
    });
  },

  /**
   * Next per-tenant task reference. Uses an aggregate rather than a counter
   * column; the caller runs it inside the same transaction as the insert, and
   * the `@@unique([organizationId, reference])` constraint catches any race.
   */
  async nextReference(scope: TenantScope): Promise<number> {
    const result = await client(scope).task.aggregate({
      where: { organizationId: scope.organizationId },
      _max: { reference: true },
    });
    return (result._max.reference ?? 0) + 1;
  },

  async countByStatus(scope: TenantScope, visibleToEmployeeIds: readonly string[] | null) {
    const rows = await client(scope).task.groupBy({
      by: ["status"],
      where: buildTaskWhere(scope, {}, visibleToEmployeeIds),
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  },

  async countByPriority(scope: TenantScope, visibleToEmployeeIds: readonly string[] | null) {
    const rows = await client(scope).task.groupBy({
      by: ["priority"],
      where: buildTaskWhere(scope, {}, visibleToEmployeeIds),
      _count: { _all: true },
    });
    return rows.map((row) => ({ priority: row.priority, count: row._count._all }));
  },

  async countOverdue(scope: TenantScope, visibleToEmployeeIds: readonly string[] | null) {
    return client(scope).task.count({
      where: buildTaskWhere(scope, { overdue: true }, visibleToEmployeeIds),
    });
  },

  /** Open-task load per employee, for the workload chart. */
  async workloadByEmployee(scope: TenantScope, employeeIds: readonly string[]) {
    if (employeeIds.length === 0) return [];
    const rows = await client(scope).taskAssignee.groupBy({
      by: ["employeeId"],
      where: {
        employeeId: { in: [...employeeIds] },
        task: {
          organizationId: scope.organizationId,
          deletedAt: null,
          status: { notIn: ["COMPLETED"] },
        },
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({ employeeId: row.employeeId, openTasks: row._count._all }));
  },

  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const result = await client(scope).task.updateMany({
      where: { id, ...liveTenantWhere(scope) },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  },
};
