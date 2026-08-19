import "server-only";

import { execute, query, queryExactlyOne, queryOne } from "@/server/db/query";
import { exec, type TenantScope } from "@/server/db/tenant";
import { nullableRelation, toNumber, type LeaveStatus, type LeaveType } from "@/server/db/types";

/**
 * Leave requests.
 *
 * Approved leave is not merely a record: `attendanceRepository.findApprovedLeave`
 * consults it on every attendance computation, so approving a request
 * retroactively turns those days from ABSENT into ON_LEAVE. That coupling is
 * why the writes here are narrow and explicit rather than a general `update`.
 */

export interface LeaveRecord {
  id: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    designation: string;
    managerId: string | null;
  };
  reviewer: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  } | null;
}

interface LeaveRow {
  id: string;
  type: LeaveType;
  status: LeaveStatus;
  start_date: Date;
  end_date: Date;
  /** NUMERIC arrives from pg as a string, to avoid silent float rounding. */
  days: string;
  reason: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  employee_id: string;
  employee_first_name: string;
  employee_last_name: string;
  employee_avatar_url: string | null;
  employee_designation: string;
  employee_manager_id: string | null;
  reviewer_id: string | null;
  reviewer_first_name: string | null;
  reviewer_last_name: string | null;
  reviewer_avatar_url: string | null;
}

const LEAVE_SELECT = `
  l.id, l.type, l.status, l.start_date, l.end_date, l.days, l.reason,
  l.reviewed_at, l.review_note, l.created_at,
  e.id          AS employee_id,
  e.first_name  AS employee_first_name,
  e.last_name   AS employee_last_name,
  e.avatar_url  AS employee_avatar_url,
  e.designation AS employee_designation,
  e.manager_id  AS employee_manager_id,
  r.id          AS reviewer_id,
  r.first_name  AS reviewer_first_name,
  r.last_name   AS reviewer_last_name,
  r.avatar_url  AS reviewer_avatar_url
`;

const LEAVE_FROM = `
  leaves l
  JOIN employees e      ON e.id = l.employee_id
  LEFT JOIN employees r ON r.id = l.reviewer_id
`;

function mapLeave(row: LeaveRow): LeaveRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    days: toNumber(row.days),
    reason: row.reason,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    employee: {
      id: row.employee_id,
      firstName: row.employee_first_name,
      lastName: row.employee_last_name,
      avatarUrl: row.employee_avatar_url,
      designation: row.employee_designation,
      managerId: row.employee_manager_id,
    },
    reviewer: nullableRelation(row.reviewer_id, () => ({
      id: row.reviewer_id!,
      firstName: row.reviewer_first_name!,
      lastName: row.reviewer_last_name!,
      avatarUrl: row.reviewer_avatar_url,
    })),
  };
}

/**
 * `employeeIds` is the caller's visibility envelope, resolved server-side from
 * their own reporting line. `null` means "no restriction", which only an
 * org-wide role produces. An empty array means "nobody", and must return
 * nothing rather than everything — `= ANY('{}')` is false for every row, which
 * is the behaviour we want.
 */
type Envelope = readonly string[] | null;

export const leaveRepository = {
  /** One employee's own requests, newest first. */
  async listForEmployee(
    scope: TenantScope,
    employeeId: string,
    limit = 50,
  ): Promise<LeaveRecord[]> {
    const rows = await query<LeaveRow>(
      `SELECT ${LEAVE_SELECT} FROM ${LEAVE_FROM}
        WHERE l.organization_id = $1 AND l.employee_id = $2
        ORDER BY l.start_date DESC
        LIMIT $3`,
      [scope.organizationId, employeeId, limit],
      exec(scope),
    );

    return rows.map(mapLeave);
  },

  /**
   * Requests a reviewer may decide.
   *
   * `excludeEmployeeId` keeps the reviewer's own request out of their queue —
   * the database rejects self-approval outright, so surfacing it would only
   * offer an action that cannot succeed.
   */
  async listForReview(
    scope: TenantScope,
    filters: { employeeIds: Envelope; status?: LeaveStatus; excludeEmployeeId?: string | null },
    limit = 60,
  ): Promise<LeaveRecord[]> {
    const rows = await query<LeaveRow>(
      `SELECT ${LEAVE_SELECT} FROM ${LEAVE_FROM}
        WHERE l.organization_id = $1
          AND ($2::uuid[] IS NULL OR l.employee_id = ANY($2::uuid[]))
          AND ($3::leave_status IS NULL OR l.status = $3::leave_status)
          AND ($4::uuid IS NULL OR l.employee_id <> $4::uuid)
        ORDER BY l.status ASC, l.start_date DESC
        LIMIT $5`,
      [
        scope.organizationId,
        filters.employeeIds ? [...filters.employeeIds] : null,
        filters.status ?? null,
        filters.excludeEmployeeId ?? null,
        limit,
      ],
      exec(scope),
    );

    return rows.map(mapLeave);
  },

  /**
   * Approved days per leave type since a date.
   *
   * Summed in PostgreSQL rather than by reading the rows and adding them up in
   * JavaScript: the answer is one number per type, and the rows are not needed.
   */
  async takenByType(
    scope: TenantScope,
    employeeId: string,
    since: Date,
  ): Promise<Map<LeaveType, number>> {
    const rows = await query<{ type: LeaveType; total: string }>(
      `SELECT type, SUM(days) AS total
         FROM leaves
        WHERE organization_id = $1
          AND employee_id = $2
          AND status = 'APPROVED'
          AND start_date >= $3
        GROUP BY type`,
      [scope.organizationId, employeeId, since],
      exec(scope),
    );

    return new Map(rows.map((row) => [row.type, toNumber(row.total)]));
  },

  /**
   * An existing request that overlaps the given range.
   *
   * Overlap is `existing.start <= new.end AND existing.end >= new.start`, which
   * covers containment in both directions as well as partial overlap. Only
   * PENDING and APPROVED count — a cancelled or declined request does not
   * block a new one.
   */
  async findOverlapping(
    scope: TenantScope,
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ id: string; startDate: Date; endDate: Date } | null> {
    const row = await queryOne<{ id: string; start_date: Date; end_date: Date }>(
      `SELECT id, start_date, end_date
         FROM leaves
        WHERE organization_id = $1
          AND employee_id = $2
          AND status IN ('PENDING', 'APPROVED')
          AND start_date <= $4
          AND end_date >= $3
        LIMIT 1`,
      [scope.organizationId, employeeId, startDate, endDate],
      exec(scope),
    );

    return row ? { id: row.id, startDate: row.start_date, endDate: row.end_date } : null;
  },

  async create(
    scope: TenantScope,
    data: {
      employeeId: string;
      type: LeaveType;
      startDate: Date;
      endDate: Date;
      days: number;
      reason?: string | null;
    },
  ): Promise<LeaveRecord> {
    const inserted = await queryExactlyOne<{ id: string }>(
      `INSERT INTO leaves (organization_id, employee_id, type, status, start_date, end_date, days, reason)
       VALUES ($1, $2, $3::leave_type, 'PENDING', $4, $5, $6, $7)
       RETURNING id`,
      [
        scope.organizationId,
        data.employeeId,
        data.type,
        data.startDate,
        data.endDate,
        data.days,
        data.reason ?? null,
      ],
      exec(scope),
    );

    return this.requireById(scope, inserted.id);
  },

  async findById(scope: TenantScope, id: string): Promise<LeaveRecord | null> {
    const row = await queryOne<LeaveRow>(
      `SELECT ${LEAVE_SELECT} FROM ${LEAVE_FROM}
        WHERE l.id = $1 AND l.organization_id = $2`,
      [id, scope.organizationId],
      exec(scope),
    );

    return row ? mapLeave(row) : null;
  },

  async requireById(scope: TenantScope, id: string): Promise<LeaveRecord> {
    const leave = await this.findById(scope, id);
    if (!leave) {
      // 404 rather than 403 — a caller in another tenant must not learn that
      // this id exists at all.
      const error = new Error("leave request not found");
      (error as Error & { code?: string }).code = "NOT_FOUND";
      throw error;
    }
    return leave;
  },

  /**
   * Record a decision.
   *
   * The `status = 'PENDING'` guard is what makes this safe against two
   * reviewers acting at once: the second UPDATE matches no row, and the caller
   * turns that into the same 409 the pre-check produces.
   */
  async review(
    scope: TenantScope,
    id: string,
    decision: { status: Extract<LeaveStatus, "APPROVED" | "REJECTED">; reviewerId: string | null; reviewNote?: string | null },
  ): Promise<boolean> {
    const affected = await execute(
      `UPDATE leaves
          SET status = $3::leave_status,
              reviewer_id = $4,
              reviewed_at = NOW(),
              review_note = $5
        WHERE id = $1 AND organization_id = $2 AND status = 'PENDING'`,
      [id, scope.organizationId, decision.status, decision.reviewerId, decision.reviewNote ?? null],
      exec(scope),
    );

    return affected > 0;
  },

  /**
   * Withdraw one's own pending request.
   *
   * The employee id is part of the WHERE clause rather than checked beforehand,
   * so there is no window between the check and the write in which the row
   * could change hands.
   */
  async cancelPending(scope: TenantScope, id: string, employeeId: string): Promise<boolean> {
    const affected = await execute(
      `UPDATE leaves
          SET status = 'CANCELLED'
        WHERE id = $1
          AND organization_id = $2
          AND employee_id = $3
          AND status = 'PENDING'`,
      [id, scope.organizationId, employeeId],
      exec(scope),
    );

    return affected > 0;
  },

  /** Approved leave overlapping a range — the team calendar. */
  async listApprovedInRange(
    scope: TenantScope,
    filters: { employeeIds: Envelope; from: Date; to: Date },
    limit = 40,
  ): Promise<LeaveRecord[]> {
    const rows = await query<LeaveRow>(
      `SELECT ${LEAVE_SELECT} FROM ${LEAVE_FROM}
        WHERE l.organization_id = $1
          AND l.status = 'APPROVED'
          AND ($2::uuid[] IS NULL OR l.employee_id = ANY($2::uuid[]))
          AND l.start_date <= $4
          AND l.end_date >= $3
        ORDER BY l.start_date ASC
        LIMIT $5`,
      [
        scope.organizationId,
        filters.employeeIds ? [...filters.employeeIds] : null,
        filters.from,
        filters.to,
        limit,
      ],
      exec(scope),
    );

    return rows.map(mapLeave);
  },
};
