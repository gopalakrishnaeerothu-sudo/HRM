import "server-only";

import type { TaskQuery } from "@/lib/validation/task";
import { count, execute, likePattern, query, queryExactlyOne, queryOne } from "@/server/db/query";
import {
  exec,
  limitOffset,
  paginate,
  type Paginated,
  type TenantScope,
} from "@/server/db/tenant";
import {
  nullableRelation,
  toCount,
  toStringArray,
  type TaskActivityType,
  type TaskPriority,
  type TaskStatus,
} from "@/server/db/types";

/**
 * Tasks, their assignees, subtasks and collaboration records.
 *
 * The visibility argument (`visibleToEmployeeIds`) is the authorisation
 * boundary and is resolved on the server from the caller's own reporting line —
 * never from the request. Passing `null` means "no restriction", which only an
 * administrator's scope produces.
 */

export interface TaskSummary {
  id: string;
  reference: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  tags: string[];
  boardOrder: number;
  createdAt: Date;
  updatedAt: Date;
  team: { id: string; name: string; color: string } | null;
  creator: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  } | null;
  assignees: Array<{
    isOwner: boolean;
    employee: {
      id: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      designation: string;
    };
  }>;
  counts: { comments: number; attachments: number; subtasks: number };
}

interface TaskRow {
  id: string;
  reference: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  start_date: Date | null;
  due_date: Date | null;
  completed_at: Date | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  tags: string[];
  board_order: number;
  created_at: Date;
  updated_at: Date;
  team_id: string | null;
  team_name: string | null;
  team_color: string | null;
  creator_id: string | null;
  creator_first_name: string | null;
  creator_last_name: string | null;
  creator_avatar_url: string | null;
  assignees: Array<{
    is_owner: boolean;
    id: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    designation: string;
  }> | null;
  comment_count: string;
  attachment_count: string;
  subtask_count: string;
}

const TASK_SELECT = `
  t.id, t.reference, t.title, t.description, t.status, t.priority, t.progress,
  t.start_date, t.due_date, t.completed_at, t.estimated_hours, t.actual_hours,
  t.tags, t.board_order, t.created_at, t.updated_at,
  tm.id AS team_id, tm.name AS team_name, tm.color AS team_color,
  c.id AS creator_id, c.first_name AS creator_first_name,
  c.last_name AS creator_last_name, c.avatar_url AS creator_avatar_url,
  (
    SELECT json_agg(
             json_build_object(
               'is_owner',    ta.is_owner,
               'id',          e.id,
               'first_name',  e.first_name,
               'last_name',   e.last_name,
               'avatar_url',  e.avatar_url,
               'designation', e.designation
             ) ORDER BY ta.is_owner DESC, e.first_name ASC
           )
      FROM task_assignees ta
      JOIN employees e ON e.id = ta.employee_id AND e.deleted_at IS NULL
     WHERE ta.task_id = t.id
  ) AS assignees,
  (SELECT count(*) FROM task_comments tc
    WHERE tc.task_id = t.id AND tc.deleted_at IS NULL) AS comment_count,
  (SELECT count(*) FROM task_attachments tat WHERE tat.task_id = t.id) AS attachment_count,
  (SELECT count(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_count
`;

const TASK_FROM = `
  tasks t
  LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN employees c ON c.id = t.creator_id
`;

function mapTask(row: TaskRow): TaskSummary {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    startDate: row.start_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
    tags: toStringArray(row.tags),
    boardOrder: row.board_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    team: nullableRelation(row.team_id, () => ({
      id: row.team_id!,
      name: row.team_name!,
      color: row.team_color!,
    })),
    creator: nullableRelation(row.creator_id, () => ({
      id: row.creator_id!,
      firstName: row.creator_first_name!,
      lastName: row.creator_last_name!,
      avatarUrl: row.creator_avatar_url,
    })),
    assignees: (row.assignees ?? []).map((assignee) => ({
      isOwner: assignee.is_owner,
      employee: {
        id: assignee.id,
        firstName: assignee.first_name,
        lastName: assignee.last_name,
        avatarUrl: assignee.avatar_url,
        designation: assignee.designation,
      },
    })),
    counts: {
      comments: toCount(row.comment_count),
      attachments: toCount(row.attachment_count),
      subtasks: toCount(row.subtask_count),
    },
  };
}

/** Accumulates conditions and their parameters together so the two cannot drift. */
class TaskFilter {
  readonly params: unknown[];
  private readonly conditions: string[];

  constructor(organizationId: string) {
    this.params = [organizationId];
    this.conditions = ["t.organization_id = $1", "t.deleted_at IS NULL"];
  }

  add(fragment: string, ...values: unknown[]): void {
    let index = 0;
    const resolved = fragment.replace(/\$\?/g, () => {
      this.params.push(values[index]);
      index += 1;
      return `$${this.params.length}`;
    });

    if (index !== values.length) {
      throw new Error(`Task filter placeholder mismatch in: ${fragment}`);
    }

    this.conditions.push(resolved);
  }

  get where(): string {
    return `WHERE ${this.conditions.join(" AND ")}`;
  }
}

export function buildTaskFilter(
  scope: TenantScope,
  criteria: Partial<TaskQuery>,
  visibleToEmployeeIds: readonly string[] | null,
): TaskFilter {
  const filter = new TaskFilter(scope.organizationId);

  // The visibility envelope. An empty array is meaningful — it means the caller
  // can see nothing — so it must still be applied rather than skipped.
  if (visibleToEmployeeIds) {
    filter.add(
      `(EXISTS (SELECT 1 FROM task_assignees ta2
                 WHERE ta2.task_id = t.id AND ta2.employee_id = ANY($?::uuid[]))
        OR t.creator_id = ANY($?::uuid[]))`,
      [...visibleToEmployeeIds],
      [...visibleToEmployeeIds],
    );
  }

  if (criteria.status) {
    const statuses = Array.isArray(criteria.status) ? criteria.status : [criteria.status];
    filter.add("t.status = ANY($?::task_status[])", statuses);
  }

  if (criteria.priority) {
    const priorities = Array.isArray(criteria.priority) ? criteria.priority : [criteria.priority];
    filter.add("t.priority = ANY($?::task_priority[])", priorities);
  }

  if (criteria.teamId) filter.add("t.team_id = $?", criteria.teamId);
  if (criteria.creatorId) filter.add("t.creator_id = $?", criteria.creatorId);

  if (criteria.assigneeId) {
    filter.add(
      `EXISTS (SELECT 1 FROM task_assignees ta3
                WHERE ta3.task_id = t.id AND ta3.employee_id = $?)`,
      criteria.assigneeId,
    );
  }

  if (criteria.overdue) {
    filter.add("t.due_date < NOW() AND t.status <> 'COMPLETED'");
  }

  if (criteria.dueBefore) filter.add("t.due_date <= $?", criteria.dueBefore);
  if (criteria.dueAfter) filter.add("t.due_date >= $?", criteria.dueAfter);

  if (criteria.search) {
    const term = criteria.search;
    // Reference lookup: "TF-118" or "118" both find task #118.
    const digits = term.replace(/\D/g, "");
    const reference = digits.length > 0 ? Number(digits) : Number.NaN;
    const referenceOrNull = Number.isSafeInteger(reference) && reference > 0 ? reference : null;

    // likePattern escapes % and _ — parameterising a value prevents injection
    // but does NOT stop it being read as a wildcard inside a LIKE pattern.
    filter.add(
      `(t.title ILIKE $? ESCAPE '\\'
        OR t.description ILIKE $? ESCAPE '\\'
        OR $? = ANY(t.tags)
        OR ($?::int IS NOT NULL AND t.reference = $?::int))`,
      likePattern(term),
      likePattern(term),
      term.toLowerCase(),
      referenceOrNull,
      referenceOrNull,
    );
  }

  return filter;
}

function buildOrderBy(criteria: Partial<TaskQuery>): string {
  const direction = criteria.sortOrder === "desc" ? "DESC" : "ASC";
  const inverse = direction === "ASC" ? "DESC" : "ASC";

  switch (criteria.sortBy) {
    case "priority":
      // The enum is declared LOW→URGENT, so ascending puts URGENT last. Users
      // asking to sort by priority mean "most urgent first", hence the inverse.
      return `ORDER BY t.priority ${inverse}, t.due_date ASC NULLS LAST, t.id ASC`;
    case "createdAt":
      return `ORDER BY t.created_at ${direction}, t.id ASC`;
    case "title":
      return `ORDER BY t.title ${direction}, t.id ASC`;
    case "status":
      return `ORDER BY t.status ${direction}, t.board_order ASC, t.id ASC`;
    default:
      // A task with no due date sorts last in either direction: undated work is
      // not "due first", it is simply unscheduled.
      return `ORDER BY t.due_date ${direction} NULLS LAST, t.priority DESC, t.id ASC`;
  }
}

export const sqlTaskRepository = {
  async list(
    scope: TenantScope,
    criteria: TaskQuery,
    visibleToEmployeeIds: readonly string[] | null,
  ): Promise<Paginated<TaskSummary>> {
    const executor = exec(scope);
    const filter = buildTaskFilter(scope, criteria, visibleToEmployeeIds);
    const { limit, offset } = limitOffset(criteria.page ?? 1, criteria.pageSize ?? 20);

    const [rows, total] = await Promise.all([
      query<TaskRow>(
        `SELECT ${TASK_SELECT} FROM ${TASK_FROM} ${filter.where}
         ${buildOrderBy(criteria)}
         LIMIT $${filter.params.length + 1} OFFSET $${filter.params.length + 2}`,
        [...filter.params, limit, offset],
        executor,
      ),
      count(`SELECT count(*) FROM ${TASK_FROM} ${filter.where}`, filter.params, executor),
    ]);

    return paginate(rows.map(mapTask), total, criteria.page ?? 1, limit);
  },

  /** Board columns need every matching task, not a page of them. */
  async listForBoard(
    scope: TenantScope,
    criteria: Partial<TaskQuery>,
    visibleToEmployeeIds: readonly string[] | null,
    cap = 500,
  ): Promise<TaskSummary[]> {
    const filter = buildTaskFilter(scope, criteria, visibleToEmployeeIds);

    const rows = await query<TaskRow>(
      `SELECT ${TASK_SELECT} FROM ${TASK_FROM} ${filter.where}
       ORDER BY t.board_order ASC, t.created_at DESC
       LIMIT $${filter.params.length + 1}`,
      [...filter.params, cap],
      exec(scope),
    );

    return rows.map(mapTask);
  },

  async findById(scope: TenantScope, id: string) {
    const executor = exec(scope);

    const row = await queryOne<TaskRow>(
      `SELECT ${TASK_SELECT} FROM ${TASK_FROM}
        WHERE t.id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL`,
      [id, scope.organizationId],
      executor,
    );

    if (!row) return null;

    const [subtasks, comments, attachments, activities] = await Promise.all([
      query<{
        id: string;
        title: string;
        is_completed: boolean;
        completed_at: Date | null;
        position: number;
      }>(
        `SELECT id, title, is_completed, completed_at, position
           FROM subtasks WHERE task_id = $1 ORDER BY position ASC`,
        [id],
        executor,
      ),
      query<{
        id: string;
        body: string;
        created_at: Date;
        author_id: string | null;
        author_first_name: string | null;
        author_last_name: string | null;
        author_avatar_url: string | null;
      }>(
        `SELECT tc.id, tc.body, tc.created_at,
                a.id AS author_id, a.first_name AS author_first_name,
                a.last_name AS author_last_name, a.avatar_url AS author_avatar_url
           FROM task_comments tc
           LEFT JOIN employees a ON a.id = tc.author_id
          WHERE tc.task_id = $1 AND tc.deleted_at IS NULL
          ORDER BY tc.created_at ASC`,
        [id],
        executor,
      ),
      query<{
        id: string;
        file_name: string;
        file_size: string;
        mime_type: string;
        storage_key: string;
        created_at: Date;
        uploader_id: string | null;
        uploader_first_name: string | null;
        uploader_last_name: string | null;
      }>(
        `SELECT ta.id, ta.file_name, ta.file_size, ta.mime_type, ta.storage_key, ta.created_at,
                u.id AS uploader_id, u.first_name AS uploader_first_name,
                u.last_name AS uploader_last_name
           FROM task_attachments ta
           LEFT JOIN employees u ON u.id = ta.uploader_id
          WHERE ta.task_id = $1
          ORDER BY ta.created_at DESC`,
        [id],
        executor,
      ),
      query<{
        id: string;
        type: TaskActivityType;
        message: string;
        from_value: string | null;
        to_value: string | null;
        created_at: Date;
        actor_id: string | null;
        actor_first_name: string | null;
        actor_last_name: string | null;
        actor_avatar_url: string | null;
      }>(
        // Capped like the Prisma version it replaces: a long-lived task
        // accumulates hundreds of entries and the timeline only shows recent
        // ones.
        `SELECT tac.id, tac.type, tac.message, tac.from_value, tac.to_value, tac.created_at,
                a.id AS actor_id, a.first_name AS actor_first_name,
                a.last_name AS actor_last_name, a.avatar_url AS actor_avatar_url
           FROM task_activity tac
           LEFT JOIN employees a ON a.id = tac.actor_id
          WHERE tac.task_id = $1
          ORDER BY tac.created_at DESC
          LIMIT 60`,
        [id],
        executor,
      ),
    ]);

    return {
      ...mapTask(row),
      description: row.description,
      subtasks: subtasks.map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        isCompleted: subtask.is_completed,
        completedAt: subtask.completed_at,
        position: subtask.position,
      })),
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.created_at,
        author: nullableRelation(comment.author_id, () => ({
          id: comment.author_id!,
          firstName: comment.author_first_name!,
          lastName: comment.author_last_name!,
          avatarUrl: comment.author_avatar_url,
        })),
      })),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.file_name,
        // BIGINT arrives as a string from pg — it can exceed Number's safe
        // range in general, though a file size never will.
        fileSize: Number(attachment.file_size),
        mimeType: attachment.mime_type,
        storageKey: attachment.storage_key,
        createdAt: attachment.created_at,
        uploader: nullableRelation(attachment.uploader_id, () => ({
          id: attachment.uploader_id!,
          firstName: attachment.uploader_first_name!,
          lastName: attachment.uploader_last_name!,
        })),
      })),
      activities: activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        message: activity.message,
        fromValue: activity.from_value,
        toValue: activity.to_value,
        createdAt: activity.created_at,
        actor: nullableRelation(activity.actor_id, () => ({
          id: activity.actor_id!,
          firstName: activity.actor_first_name!,
          lastName: activity.actor_last_name!,
          avatarUrl: activity.actor_avatar_url,
        })),
      })),
    };
  },

  async requireById(scope: TenantScope, id: string) {
    const task = await this.findById(scope, id);
    if (!task) {
      // 404 rather than 403: a caller in another tenant must not learn that
      // this id exists at all.
      const error = new Error("task not found");
      (error as Error & { code?: string }).code = "NOT_FOUND";
      throw error;
    }
    return task;
  },

  /**
   * Next reference number for this tenant.
   *
   * Computed inside the INSERT rather than read first, so two concurrent
   * creations cannot both read the same maximum. Callers pass a transaction
   * when the task and its assignees must appear together.
   */
  async create(
    scope: TenantScope,
    data: {
      title: string;
      description?: string | null;
      status?: TaskStatus;
      priority?: TaskPriority;
      teamId?: string | null;
      creatorId?: string | null;
      startDate?: Date | null;
      dueDate?: Date | null;
      estimatedHours?: number | null;
      tags?: readonly string[];
      assigneeIds?: readonly string[];
      ownerId?: string | null;
    },
  ): Promise<string> {
    const executor = exec(scope);

    const inserted = await queryExactlyOne<{ id: string }>(
      `INSERT INTO tasks (
         organization_id, reference, title, description, status, priority,
         team_id, creator_id, start_date, due_date, estimated_hours, tags
       )
       VALUES (
         $1,
         (SELECT COALESCE(MAX(reference), 0) + 1 FROM tasks WHERE organization_id = $1),
         $2, $3, COALESCE($4,'TODO')::task_status, COALESCE($5,'MEDIUM')::task_priority,
         $6, $7, $8, $9, $10, COALESCE($11::text[], ARRAY[]::text[])
       )
       RETURNING id`,
      [
        scope.organizationId,
        data.title,
        data.description ?? null,
        data.status ?? null,
        data.priority ?? null,
        data.teamId ?? null,
        data.creatorId ?? null,
        data.startDate ?? null,
        data.dueDate ?? null,
        data.estimatedHours ?? null,
        data.tags ? [...data.tags] : null,
      ],
      executor,
    );

    if (data.assigneeIds?.length) {
      await this.replaceAssignees(scope, inserted.id, data.assigneeIds, data.ownerId ?? null);
    }

    return inserted.id;
  },

  async update(
    scope: TenantScope,
    id: string,
    data: {
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      priority?: TaskPriority;
      progress?: number;
      teamId?: string | null;
      startDate?: Date | null;
      dueDate?: Date | null;
      estimatedHours?: number | null;
      actualHours?: number | null;
      tags?: readonly string[];
      boardOrder?: number;
      completedAt?: Date | null;
    },
  ): Promise<boolean> {
    const affected = await execute(
      `UPDATE tasks SET
         title           = COALESCE($3, title),
         description     = COALESCE($4, description),
         status          = COALESCE($5::task_status, status),
         priority        = COALESCE($6::task_priority, priority),
         progress        = COALESCE($7, progress),
         team_id         = COALESCE($8, team_id),
         start_date      = COALESCE($9, start_date),
         due_date        = COALESCE($10, due_date),
         estimated_hours = COALESCE($11, estimated_hours),
         actual_hours    = COALESCE($12, actual_hours),
         tags            = COALESCE($13::text[], tags),
         board_order     = COALESCE($14, board_order),
         completed_at    = CASE
                             WHEN $5::task_status = 'COMPLETED' THEN COALESCE($15, NOW())
                             WHEN $5::task_status IS NOT NULL THEN NULL
                             ELSE completed_at
                           END
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [
        id,
        scope.organizationId,
        data.title ?? null,
        data.description ?? null,
        data.status ?? null,
        data.priority ?? null,
        data.progress ?? null,
        data.teamId ?? null,
        data.startDate ?? null,
        data.dueDate ?? null,
        data.estimatedHours ?? null,
        data.actualHours ?? null,
        data.tags ? [...data.tags] : null,
        data.boardOrder ?? null,
        data.completedAt ?? null,
      ],
      exec(scope),
    );

    return affected > 0;
  },

  /**
   * Assignees, with exactly one owner.
   *
   * Migration 009 enforces the single owner with a partial unique index, so
   * the ordering below is not merely tidy — inserting two owners raises.
   */
  async replaceAssignees(
    scope: TenantScope,
    taskId: string,
    employeeIds: readonly string[],
    ownerId: string | null,
  ): Promise<void> {
    const executor = exec(scope);

    await execute(
      `DELETE FROM task_assignees ta
        USING tasks t
        WHERE ta.task_id = t.id AND ta.task_id = $1 AND t.organization_id = $2`,
      [taskId, scope.organizationId],
      executor,
    );

    if (employeeIds.length === 0) return;

    const owner = ownerId && employeeIds.includes(ownerId) ? ownerId : employeeIds[0]!;

    await execute(
      `INSERT INTO task_assignees (task_id, employee_id, is_owner)
       SELECT $1, e.id, (e.id = $4)
         FROM employees e
        WHERE e.id = ANY($2::uuid[])
          AND e.organization_id = $3
          AND e.deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [taskId, [...employeeIds], scope.organizationId, owner],
      executor,
    );
  },

  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const affected = await execute(
      `UPDATE tasks SET deleted_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, scope.organizationId],
      exec(scope),
    );

    return affected > 0;
  },

  // --- Roll-ups -------------------------------------------------------------

  async countByStatus(
    scope: TenantScope,
    visibleToEmployeeIds: readonly string[] | null,
  ): Promise<Array<{ status: TaskStatus; count: number }>> {
    const filter = buildTaskFilter(scope, {}, visibleToEmployeeIds);

    const rows = await query<{ status: TaskStatus; count: string }>(
      `SELECT t.status, count(*) AS count FROM ${TASK_FROM} ${filter.where} GROUP BY t.status`,
      filter.params,
      exec(scope),
    );

    return rows.map((row) => ({ status: row.status, count: toCount(row.count) }));
  },

  async countByPriority(
    scope: TenantScope,
    visibleToEmployeeIds: readonly string[] | null,
  ): Promise<Array<{ priority: TaskPriority; count: number }>> {
    const filter = buildTaskFilter(scope, {}, visibleToEmployeeIds);

    const rows = await query<{ priority: TaskPriority; count: string }>(
      `SELECT t.priority, count(*) AS count FROM ${TASK_FROM} ${filter.where} GROUP BY t.priority`,
      filter.params,
      exec(scope),
    );

    return rows.map((row) => ({ priority: row.priority, count: toCount(row.count) }));
  },

  async countOverdue(
    scope: TenantScope,
    visibleToEmployeeIds: readonly string[] | null,
  ): Promise<number> {
    const filter = buildTaskFilter(scope, { overdue: true }, visibleToEmployeeIds);

    return count(`SELECT count(*) FROM ${TASK_FROM} ${filter.where}`, filter.params, exec(scope));
  },

  /** Open task load per employee, for the workload chart. */
  async workloadByEmployee(
    scope: TenantScope,
    visibleToEmployeeIds: readonly string[] | null,
  ): Promise<Array<{ employeeId: string; firstName: string; lastName: string; open: number }>> {
    const filter = buildTaskFilter(scope, {}, visibleToEmployeeIds);

    const rows = await query<{
      employee_id: string;
      first_name: string;
      last_name: string;
      open: string;
    }>(
      `SELECT e.id AS employee_id, e.first_name, e.last_name, count(*) AS open
         FROM ${TASK_FROM}
         JOIN task_assignees ta ON ta.task_id = t.id
         JOIN employees e ON e.id = ta.employee_id AND e.deleted_at IS NULL
         ${filter.where} AND t.status <> 'COMPLETED'
        GROUP BY e.id, e.first_name, e.last_name
        ORDER BY count(*) DESC, e.first_name ASC`,
      filter.params,
      exec(scope),
    );

    return rows.map((row) => ({
      employeeId: row.employee_id,
      firstName: row.first_name,
      lastName: row.last_name,
      open: toCount(row.open),
    }));
  },

  // --- Collaboration --------------------------------------------------------

  async addComment(
    scope: TenantScope,
    taskId: string,
    authorId: string,
    body: string,
  ): Promise<string | null> {
    // The SELECT is the tenant check: a task id from another organisation
    // inserts nothing rather than attaching a comment to it.
    const row = await queryOne<{ id: string }>(
      `INSERT INTO task_comments (organization_id, task_id, author_id, body)
       SELECT $1, t.id, $3, $4
         FROM tasks t
        WHERE t.id = $2 AND t.organization_id = $1 AND t.deleted_at IS NULL
       RETURNING id`,
      [scope.organizationId, taskId, authorId, body],
      exec(scope),
    );

    return row?.id ?? null;
  },

  async setSubtaskCompletion(
    scope: TenantScope,
    subtaskId: string,
    isCompleted: boolean,
  ): Promise<boolean> {
    const affected = await execute(
      `UPDATE subtasks s SET
         is_completed = $3,
         completed_at = CASE WHEN $3 THEN NOW() ELSE NULL END
        FROM tasks t
       WHERE s.task_id = t.id AND s.id = $1 AND t.organization_id = $2`,
      [subtaskId, scope.organizationId, isCompleted],
      exec(scope),
    );

    return affected > 0;
  },
};
