import "server-only";

import { count, db, execute, query, queryExactlyOne, queryOne, type Executor } from "@/server/db/query";
import { assertFound, exec, type TenantScope } from "@/server/db/tenant";
import {
  nullableRelation,
  toCount,
  toNumber,
  type AuditAction,
  type EmployeeStatus,
  type NotificationChannel,
  type NotificationType,
  type UserRole,
} from "@/server/db/types";

/** Teams, departments, notifications, the audit log and organisation settings. */

// --- Teams ------------------------------------------------------------------

export interface TeamRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  createdAt: Date;
  department: { id: string; name: string; color: string } | null;
  manager: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    designation: string;
  } | null;
  members: Array<{
    roleLabel: string | null;
    joinedAt: Date;
    employee: {
      id: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      designation: string;
      status: EmployeeStatus;
    };
  }>;
  counts: { members: number; tasks: number };
}

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  created_at: Date;
  dept_id: string | null;
  dept_name: string | null;
  dept_color: string | null;
  mgr_id: string | null;
  mgr_first_name: string | null;
  mgr_last_name: string | null;
  mgr_avatar_url: string | null;
  mgr_designation: string | null;
  members: Array<{
    role_label: string | null;
    joined_at: string;
    id: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    designation: string;
    status: EmployeeStatus;
  }> | null;
  member_count: string;
  task_count: string;
}

/**
 * Members arrive nested from a correlated json_agg rather than a second query,
 * so listing teams stays one round trip however many members they have.
 *
 * json_agg over zero rows yields NULL rather than an empty array, which is why
 * the mapper coalesces. The inner JOIN also drops soft-deleted employees, so a
 * departed member disappears from the team without a second filter.
 */
const TEAM_SELECT = `
  t.id, t.name, t.slug, t.description, t.color, t.created_at,
  d.id AS dept_id, d.name AS dept_name, d.color AS dept_color,
  m.id AS mgr_id, m.first_name AS mgr_first_name, m.last_name AS mgr_last_name,
  m.avatar_url AS mgr_avatar_url, m.designation AS mgr_designation,
  (
    SELECT json_agg(
             json_build_object(
               'role_label', tm.role_label,
               'joined_at',  tm.joined_at,
               'id',         e.id,
               'first_name', e.first_name,
               'last_name',  e.last_name,
               'avatar_url', e.avatar_url,
               'designation', e.designation,
               'status',     e.status
             ) ORDER BY tm.joined_at ASC
           )
      FROM team_members tm
      JOIN employees e ON e.id = tm.employee_id AND e.deleted_at IS NULL
     WHERE tm.team_id = t.id
  ) AS members,
  (SELECT count(*) FROM team_members tm2 WHERE tm2.team_id = t.id) AS member_count,
  (SELECT count(*) FROM tasks tk WHERE tk.team_id = t.id AND tk.deleted_at IS NULL) AS task_count
`;

const TEAM_FROM = `
  teams t
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN employees m ON m.id = t.manager_id
`;

function mapTeam(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    color: row.color,
    createdAt: row.created_at,
    department: nullableRelation(row.dept_id, () => ({
      id: row.dept_id!,
      name: row.dept_name!,
      color: row.dept_color!,
    })),
    manager: nullableRelation(row.mgr_id, () => ({
      id: row.mgr_id!,
      firstName: row.mgr_first_name!,
      lastName: row.mgr_last_name!,
      avatarUrl: row.mgr_avatar_url,
      designation: row.mgr_designation!,
    })),
    members: (row.members ?? []).map((member) => ({
      roleLabel: member.role_label,
      joinedAt: new Date(member.joined_at),
      employee: {
        id: member.id,
        firstName: member.first_name,
        lastName: member.last_name,
        avatarUrl: member.avatar_url,
        designation: member.designation,
        status: member.status,
      },
    })),
    counts: { members: toCount(row.member_count), tasks: toCount(row.task_count) },
  };
}

export const teamRepository = {
  async list(scope: TenantScope): Promise<TeamRecord[]> {
    const rows = await query<TeamRow>(
      `SELECT ${TEAM_SELECT} FROM ${TEAM_FROM}
        WHERE t.organization_id = $1 AND t.deleted_at IS NULL
        ORDER BY t.name ASC`,
      [scope.organizationId],
      exec(scope),
    );

    return rows.map(mapTeam);
  },

  async findById(scope: TenantScope, id: string): Promise<TeamRecord | null> {
    const row = await queryOne<TeamRow>(
      `SELECT ${TEAM_SELECT} FROM ${TEAM_FROM}
        WHERE t.id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL`,
      [id, scope.organizationId],
      exec(scope),
    );

    return row ? mapTeam(row) : null;
  },

  async requireById(scope: TenantScope, id: string): Promise<TeamRecord> {
    return assertFound(await this.findById(scope, id), "team");
  },

  /** Teams an employee belongs to or manages. */
  async listForEmployee(scope: TenantScope, employeeId: string): Promise<TeamRecord[]> {
    const rows = await query<TeamRow>(
      `SELECT ${TEAM_SELECT} FROM ${TEAM_FROM}
        WHERE t.organization_id = $1
          AND t.deleted_at IS NULL
          AND (
            t.manager_id = $2
            OR EXISTS (SELECT 1 FROM team_members tm3
                        WHERE tm3.team_id = t.id AND tm3.employee_id = $2)
          )
        ORDER BY t.name ASC`,
      [scope.organizationId, employeeId],
      exec(scope),
    );

    return rows.map(mapTeam);
  },

  async memberIds(scope: TenantScope, teamId: string): Promise<string[]> {
    const rows = await query<{ employee_id: string }>(
      `SELECT tm.employee_id
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
        WHERE tm.team_id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL`,
      [teamId, scope.organizationId],
      exec(scope),
    );

    return rows.map((row) => row.employee_id);
  },

  async create(
    scope: TenantScope,
    data: {
      name: string;
      slug: string;
      description?: string | null;
      color?: string;
      departmentId?: string | null;
      managerId?: string | null;
    },
  ): Promise<TeamRecord> {
    const inserted = await queryExactlyOne<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug, description, color, department_id, manager_id)
       VALUES ($1,$2,$3,$4,COALESCE($5,'#6366f1'),$6,$7)
       RETURNING id`,
      [
        scope.organizationId,
        data.name,
        data.slug,
        data.description ?? null,
        data.color ?? null,
        data.departmentId ?? null,
        data.managerId ?? null,
      ],
      exec(scope),
    );

    return this.requireById(scope, inserted.id);
  },

  async update(
    scope: TenantScope,
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string | null;
      color?: string;
      departmentId?: string | null;
      managerId?: string | null;
    },
  ): Promise<TeamRecord | null> {
    const affected = await execute(
      `UPDATE teams SET
         name          = COALESCE($3, name),
         slug          = COALESCE($4, slug),
         description   = COALESCE($5, description),
         color         = COALESCE($6, color),
         department_id = COALESCE($7, department_id),
         manager_id    = COALESCE($8, manager_id)
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [
        id,
        scope.organizationId,
        data.name ?? null,
        data.slug ?? null,
        data.description ?? null,
        data.color ?? null,
        data.departmentId ?? null,
        data.managerId ?? null,
      ],
      exec(scope),
    );

    if (affected === 0) return null;
    return this.findById(scope, id);
  },

  /**
   * Replace the membership wholesale.
   *
   * Delete-then-insert in one statement pair; callers that need this to be
   * atomic with other work pass a transaction in the scope. The join to teams
   * is the tenant boundary — team_members carries no organization_id.
   */
  async replaceMembers(
    scope: TenantScope,
    teamId: string,
    employeeIds: readonly string[],
  ): Promise<void> {
    const executor = exec(scope);

    await execute(
      `DELETE FROM team_members tm
        USING teams t
        WHERE tm.team_id = t.id
          AND tm.team_id = $1
          AND t.organization_id = $2
          AND t.deleted_at IS NULL`,
      [teamId, scope.organizationId],
      executor,
    );

    if (employeeIds.length === 0) return;

    // Employees are filtered by tenant here so a foreign id cannot be attached
    // to this team by passing it in the list.
    await execute(
      `INSERT INTO team_members (team_id, employee_id)
       SELECT $1, e.id
         FROM employees e
        WHERE e.id = ANY($2::uuid[])
          AND e.organization_id = $3
          AND e.deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [teamId, [...employeeIds], scope.organizationId],
      executor,
    );
  },

  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const affected = await execute(
      `UPDATE teams SET deleted_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, scope.organizationId],
      exec(scope),
    );

    return affected > 0;
  },

  async isSlugTaken(scope: TenantScope, slug: string, excludeId?: string): Promise<boolean> {
    const total = await count(
      `SELECT count(*) FROM teams
        WHERE organization_id = $1 AND slug = $2 AND deleted_at IS NULL
          AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [scope.organizationId, slug, excludeId ?? null],
      exec(scope),
    );

    return total > 0;
  },
};

// --- Departments ------------------------------------------------------------

export const departmentRepository = {
  async list(scope: TenantScope) {
    const rows = await query<{
      id: string;
      name: string;
      code: string;
      description: string | null;
      color: string;
      head_id: string | null;
      head_first_name: string | null;
      head_last_name: string | null;
      head_avatar_url: string | null;
      employee_count: string;
      team_count: string;
    }>(
      `SELECT d.id, d.name, d.code, d.description, d.color,
              h.id AS head_id, h.first_name AS head_first_name,
              h.last_name AS head_last_name, h.avatar_url AS head_avatar_url,
              (SELECT count(*) FROM employees e
                WHERE e.department_id = d.id AND e.deleted_at IS NULL) AS employee_count,
              (SELECT count(*) FROM teams t
                WHERE t.department_id = d.id AND t.deleted_at IS NULL) AS team_count
         FROM departments d
         LEFT JOIN employees h ON h.id = d.head_id
        WHERE d.organization_id = $1 AND d.deleted_at IS NULL
        ORDER BY d.name ASC`,
      [scope.organizationId],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      color: row.color,
      head: nullableRelation(row.head_id, () => ({
        id: row.head_id!,
        firstName: row.head_first_name!,
        lastName: row.head_last_name!,
        avatarUrl: row.head_avatar_url,
      })),
      counts: { employees: toCount(row.employee_count), teams: toCount(row.team_count) },
    }));
  },

  async create(
    scope: TenantScope,
    data: {
      name: string;
      code: string;
      description?: string | null;
      color?: string;
      headId?: string | null;
    },
  ) {
    return queryExactlyOne<{ id: string; name: string; code: string }>(
      `INSERT INTO departments (organization_id, name, code, description, color, head_id)
       VALUES ($1,$2,$3,$4,COALESCE($5,'#6366f1'),$6)
       RETURNING id, name, code`,
      [
        scope.organizationId,
        data.name,
        data.code,
        data.description ?? null,
        data.color ?? null,
        data.headId ?? null,
      ],
      exec(scope),
    );
  },
};

// --- Notifications ----------------------------------------------------------

export interface NotificationRow {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export const notificationRepository = {
  async listForUser(scope: TenantScope, userId: string, limit = 30): Promise<NotificationRow[]> {
    const rows = await query<{
      id: string;
      type: NotificationType;
      channel: NotificationChannel;
      title: string;
      body: string;
      link_url: string | null;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, type, channel, title, body, link_url, read_at, created_at
         FROM notifications
        WHERE organization_id = $1 AND user_id = $2 AND channel = 'IN_APP'
        ORDER BY created_at DESC
        LIMIT $3`,
      [scope.organizationId, userId, limit],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      channel: row.channel,
      title: row.title,
      body: row.body,
      linkUrl: row.link_url,
      readAt: row.read_at,
      createdAt: row.created_at,
    }));
  },

  async countUnread(scope: TenantScope, userId: string): Promise<number> {
    return count(
      `SELECT count(*) FROM notifications
        WHERE organization_id = $1 AND user_id = $2
          AND channel = 'IN_APP' AND read_at IS NULL`,
      [scope.organizationId, userId],
      exec(scope),
    );
  },

  /**
   * Bulk insert via UNNEST — one statement regardless of how many recipients,
   * which matters because a task assigned to a large team fans out here.
   */
  async createMany(
    scope: TenantScope,
    rows: ReadonlyArray<{
      userId: string;
      type: NotificationType;
      channel?: NotificationChannel;
      title: string;
      body: string;
      linkUrl?: string | null;
    }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    return execute(
      `INSERT INTO notifications (organization_id, user_id, type, channel, title, body, link_url)
       SELECT $1, u.user_id, u.type::notification_type, u.channel::notification_channel,
              u.title, u.body, u.link_url
         FROM UNNEST($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
              AS u(user_id, type, channel, title, body, link_url)`,
      [
        scope.organizationId,
        rows.map((row) => row.userId),
        rows.map((row) => row.type),
        rows.map((row) => row.channel ?? "IN_APP"),
        rows.map((row) => row.title),
        rows.map((row) => row.body),
        rows.map((row) => row.linkUrl ?? null),
      ],
      exec(scope),
    );
  },

  async markRead(scope: TenantScope, userId: string, notificationId: string): Promise<boolean> {
    // user_id in the filter is what stops one user marking another's notification.
    const affected = await execute(
      `UPDATE notifications SET read_at = NOW()
        WHERE id = $1 AND user_id = $2 AND organization_id = $3 AND read_at IS NULL`,
      [notificationId, userId, scope.organizationId],
      exec(scope),
    );

    return affected > 0;
  },

  async markAllRead(scope: TenantScope, userId: string): Promise<number> {
    return execute(
      `UPDATE notifications SET read_at = NOW()
        WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [scope.organizationId, userId],
      exec(scope),
    );
  },
};

// --- Audit ------------------------------------------------------------------

export const auditRepository = {
  async record(
    scope: TenantScope,
    entry: {
      actorUserId?: string | null;
      action: AuditAction;
      entityType: string;
      entityId?: string | null;
      summary: string;
      changes?: unknown;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ): Promise<string> {
    const row = await queryExactlyOne<{ id: string }>(
      `INSERT INTO audit_logs (
         organization_id, actor_user_id, action, entity_type, entity_id,
         summary, changes, ip_address, user_agent
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       RETURNING id`,
      [
        scope.organizationId,
        entry.actorUserId ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.summary,
        entry.changes === undefined ? null : JSON.stringify(entry.changes),
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
      ],
      exec(scope),
    );

    return row.id;
  },

  async list(scope: TenantScope, limit = 50, entityType?: string) {
    const rows = await query<{
      id: string;
      action: AuditAction;
      entity_type: string;
      entity_id: string | null;
      summary: string;
      changes: unknown;
      created_at: Date;
      ip_address: string | null;
      actor_id: string | null;
      actor_name: string | null;
      actor_email: string | null;
      actor_avatar_url: string | null;
      actor_role: UserRole | null;
    }>(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.summary, a.changes,
              a.created_at, a.ip_address,
              u.id AS actor_id, u.name AS actor_name, u.email AS actor_email,
              u.avatar_url AS actor_avatar_url, u.role AS actor_role
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.organization_id = $1
          AND ($2::text IS NULL OR a.entity_type = $2::text)
        ORDER BY a.created_at DESC
        LIMIT $3`,
      [scope.organizationId, entityType ?? null, limit],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      summary: row.summary,
      changes: row.changes,
      createdAt: row.created_at,
      ipAddress: row.ip_address,
      actor: nullableRelation(row.actor_id, () => ({
        id: row.actor_id!,
        name: row.actor_name!,
        email: row.actor_email!,
        avatarUrl: row.actor_avatar_url,
        role: row.actor_role!,
      })),
    }));
  },
};

// --- Organisation -----------------------------------------------------------

export interface AttendancePolicy {
  id: string;
  timezone: string;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  gracePeriodMinutes: number;
  fullDayHours: number;
  halfDayHours: number;
  weekendDays: number[];
  maxAccuracyMeters: number;
  maxTravelSpeedKmh: number;
  enforceGeofence: boolean;
  allowManualOverride: boolean;
  requireCheckoutLocation: boolean;
}

/**
 * The whole organisation, as the settings screens need it.
 *
 * Profile and policy together rather than split: every settings form reads the
 * current values to show them, and a second round-trip to fetch the half the
 * first call omitted is not worth the columns saved.
 */
export interface OrganizationRecord extends AttendancePolicy {
  slug: string;
  name: string;
  legalName: string | null;
  logoUrl: string | null;
  plan: string;
  currency: string;
  locale: string;
}

interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  logo_url: string | null;
  plan: string;
  timezone: string;
  currency: string;
  locale: string;
  workday_start_minutes: number;
  workday_end_minutes: number;
  grace_period_minutes: number;
  full_day_hours: number;
  half_day_hours: number;
  weekend_days: number[];
  max_accuracy_meters: number;
  max_travel_speed_kmh: number;
  enforce_geofence: boolean;
  allow_manual_override: boolean;
  require_checkout_location: boolean;
}

const ORGANIZATION_COLUMNS = `
  id, slug, name, legal_name, logo_url, plan, timezone, currency, locale,
  workday_start_minutes, workday_end_minutes, grace_period_minutes,
  full_day_hours, half_day_hours, weekend_days,
  max_accuracy_meters, max_travel_speed_kmh,
  enforce_geofence, allow_manual_override, require_checkout_location
`;

function mapOrganization(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    logoUrl: row.logo_url,
    plan: row.plan,
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    workdayStartMinutes: row.workday_start_minutes,
    workdayEndMinutes: row.workday_end_minutes,
    gracePeriodMinutes: row.grace_period_minutes,
    fullDayHours: toNumber(row.full_day_hours),
    halfDayHours: toNumber(row.half_day_hours),
    weekendDays: row.weekend_days,
    maxAccuracyMeters: toNumber(row.max_accuracy_meters),
    maxTravelSpeedKmh: toNumber(row.max_travel_speed_kmh),
    enforceGeofence: row.enforce_geofence,
    allowManualOverride: row.allow_manual_override,
    requireCheckoutLocation: row.require_checkout_location,
  };
}

export const organizationRepository = {
  async findById(organizationId: string, executor: Executor = db()) {
    const row = await queryOne<OrganizationRow>(
      `SELECT ${ORGANIZATION_COLUMNS} FROM organizations
        WHERE id = $1 AND deleted_at IS NULL`,
      [organizationId],
      executor,
    );

    return row ? mapOrganization(row) : null;
  },

  async requireById(organizationId: string, executor: Executor = db()) {
    return assertFound(await this.findById(organizationId, executor), "organisation");
  },

  async update(
    organizationId: string,
    data: {
      name?: string;
      legalName?: string | null;
      logoUrl?: string | null;
      timezone?: string;
      currency?: string;
      locale?: string;
      workdayStartMinutes?: number;
      workdayEndMinutes?: number;
      gracePeriodMinutes?: number;
      fullDayHours?: number;
      halfDayHours?: number;
      weekendDays?: readonly number[];
      maxAccuracyMeters?: number;
      maxTravelSpeedKmh?: number;
      enforceGeofence?: boolean;
      allowManualOverride?: boolean;
      requireCheckoutLocation?: boolean;
    },
    executor: Executor = db(),
  ): Promise<OrganizationRecord> {
    // RETURNING rather than a follow-up SELECT: the caller audits a
    // before/after diff, and re-reading could pick up a concurrent edit and
    // attribute someone else's change to this one.
    const row = await queryOne<OrganizationRow>(
      `UPDATE organizations SET
         name                      = COALESCE($2, name),
         legal_name                = COALESCE($3, legal_name),
         logo_url                  = COALESCE($4, logo_url),
         timezone                  = COALESCE($5, timezone),
         currency                  = COALESCE($6, currency),
         locale                    = COALESCE($7, locale),
         workday_start_minutes     = COALESCE($8, workday_start_minutes),
         workday_end_minutes       = COALESCE($9, workday_end_minutes),
         grace_period_minutes      = COALESCE($10, grace_period_minutes),
         full_day_hours            = COALESCE($11, full_day_hours),
         half_day_hours            = COALESCE($12, half_day_hours),
         weekend_days              = COALESCE($13::int[], weekend_days),
         max_accuracy_meters       = COALESCE($14, max_accuracy_meters),
         max_travel_speed_kmh      = COALESCE($15, max_travel_speed_kmh),
         enforce_geofence          = COALESCE($16, enforce_geofence),
         allow_manual_override     = COALESCE($17, allow_manual_override),
         require_checkout_location = COALESCE($18, require_checkout_location)
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${ORGANIZATION_COLUMNS}`,
      [
        organizationId,
        data.name ?? null,
        data.legalName ?? null,
        data.logoUrl ?? null,
        data.timezone ?? null,
        data.currency ?? null,
        data.locale ?? null,
        data.workdayStartMinutes ?? null,
        data.workdayEndMinutes ?? null,
        data.gracePeriodMinutes ?? null,
        data.fullDayHours ?? null,
        data.halfDayHours ?? null,
        data.weekendDays ? [...data.weekendDays] : null,
        data.maxAccuracyMeters ?? null,
        data.maxTravelSpeedKmh ?? null,
        data.enforceGeofence ?? null,
        data.allowManualOverride ?? null,
        data.requireCheckoutLocation ?? null,
      ],
      executor,
    );

    return assertFound(row ? mapOrganization(row) : null, "organisation");
  },

  /** The attendance policy fields, read on every check-in. */
  async policy(organizationId: string, executor: Executor = db()): Promise<AttendancePolicy> {
    const row = await queryOne<{
      id: string;
      timezone: string;
      workday_start_minutes: number;
      workday_end_minutes: number;
      grace_period_minutes: number;
      full_day_hours: number;
      half_day_hours: number;
      weekend_days: number[];
      max_accuracy_meters: number;
      max_travel_speed_kmh: number;
      enforce_geofence: boolean;
      allow_manual_override: boolean;
      require_checkout_location: boolean;
    }>(
      `SELECT id, timezone, workday_start_minutes, workday_end_minutes,
              grace_period_minutes, full_day_hours, half_day_hours, weekend_days,
              max_accuracy_meters, max_travel_speed_kmh, enforce_geofence,
              allow_manual_override, require_checkout_location
         FROM organizations
        WHERE id = $1 AND deleted_at IS NULL`,
      [organizationId],
      executor,
    );

    const organization = assertFound(row, "organisation");

    return {
      id: organization.id,
      timezone: organization.timezone,
      workdayStartMinutes: organization.workday_start_minutes,
      workdayEndMinutes: organization.workday_end_minutes,
      gracePeriodMinutes: organization.grace_period_minutes,
      fullDayHours: organization.full_day_hours,
      halfDayHours: organization.half_day_hours,
      weekendDays: organization.weekend_days,
      maxAccuracyMeters: organization.max_accuracy_meters,
      maxTravelSpeedKmh: organization.max_travel_speed_kmh,
      enforceGeofence: organization.enforce_geofence,
      allowManualOverride: organization.allow_manual_override,
      requireCheckoutLocation: organization.require_checkout_location,
    };
  },
};
