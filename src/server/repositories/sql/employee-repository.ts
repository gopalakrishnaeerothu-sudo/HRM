import "server-only";

import type { EmployeeQuery } from "@/lib/validation/employee";
import {
  assertIdentifier,
  count,
  execute,
  likePattern,
  query,
  queryExactlyOne,
  queryOne,
  sortDirection,
  WhereBuilder,
} from "@/server/db/query";
import {
  assertFound,
  exec,
  limitOffset,
  paginate,
  type Paginated,
  type TenantScope,
} from "@/server/db/tenant";
import {
  nullableRelation,
  toCount,
  type EmployeeStatus,
  type EmploymentType,
  type UserRole,
  type UserStatus,
} from "@/server/db/types";

/**
 * Employee reads and writes, in plain SQL.
 *
 * Every statement carries `organization_id = $n`. There is no code path that
 * reads an employee by id alone.
 */

// ---------------------------------------------------------------------------
// Shapes returned to the service layer
// ---------------------------------------------------------------------------

export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  designation: string;
  status: EmployeeStatus;
  employmentType: EmploymentType;
  joinedAt: Date;
  departmentId: string | null;
  managerId: string | null;
  primaryOfficeId: string | null;
  department: { id: string; name: string; code: string; color: string } | null;
  primaryOffice: { id: string; name: string; city: string } | null;
  manager: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  user: { id: string; role: UserRole; status: UserStatus } | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  bio: string | null;
  exitedAt: Date | null;
  shiftStartMinutes: number | null;
  shiftEndMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
  reports: Array<{
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    designation: string;
  }>;
  teamMemberships: Array<{
    roleLabel: string | null;
    team: { id: string; name: string; slug: string; color: string };
  }>;
  officeAccess: Array<{ office: { id: string; name: string; city: string } }>;
}

// ---------------------------------------------------------------------------
// SQL fragments
//
// The joined FROM is written once and reused by list, detail and lookup, so a
// column added to the projection cannot be missing from one of them.
// ---------------------------------------------------------------------------

const SUMMARY_COLUMNS = `
  e.id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
  e.avatar_url, e.designation, e.status, e.employment_type, e.joined_at,
  e.department_id, e.manager_id, e.primary_office_id,
  d.id AS department__id, d.name AS department__name,
  d.code AS department__code, d.color AS department__color,
  o.id AS office__id, o.name AS office__name, o.city AS office__city,
  m.id AS manager__id, m.first_name AS manager__first_name,
  m.last_name AS manager__last_name, m.avatar_url AS manager__avatar_url,
  u.id AS user__id, u.role AS user__role, u.status AS user__status
`;

const SUMMARY_FROM = `
  employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN offices o ON o.id = e.primary_office_id
  LEFT JOIN employees m ON m.id = e.manager_id
  LEFT JOIN users u ON u.id = e.user_id
`;

interface SummaryRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  designation: string;
  status: EmployeeStatus;
  employment_type: EmploymentType;
  joined_at: Date;
  department_id: string | null;
  manager_id: string | null;
  primary_office_id: string | null;
  department__id: string | null;
  department__name: string | null;
  department__code: string | null;
  department__color: string | null;
  office__id: string | null;
  office__name: string | null;
  office__city: string | null;
  manager__id: string | null;
  manager__first_name: string | null;
  manager__last_name: string | null;
  manager__avatar_url: string | null;
  user__id: string | null;
  user__role: UserRole | null;
  user__status: UserStatus | null;
}

function mapSummary(row: SummaryRow): EmployeeSummary {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    designation: row.designation,
    status: row.status,
    employmentType: row.employment_type,
    joinedAt: row.joined_at,
    departmentId: row.department_id,
    managerId: row.manager_id,
    primaryOfficeId: row.primary_office_id,

    // A LEFT JOIN with no match yields all-null columns, not an absent object.
    department: nullableRelation(row.department__id, () => ({
      id: row.department__id!,
      name: row.department__name!,
      code: row.department__code!,
      color: row.department__color!,
    })),
    primaryOffice: nullableRelation(row.office__id, () => ({
      id: row.office__id!,
      name: row.office__name!,
      city: row.office__city!,
    })),
    manager: nullableRelation(row.manager__id, () => ({
      id: row.manager__id!,
      firstName: row.manager__first_name!,
      lastName: row.manager__last_name!,
      avatarUrl: row.manager__avatar_url,
    })),
    user: nullableRelation(row.user__id, () => ({
      id: row.user__id!,
      role: row.user__role!,
      status: row.user__status!,
    })),
  };
}

/** Sort columns are allow-listed: a column name cannot be parameterised. */
const SORT_COLUMNS = {
  name: "e.first_name",
  joinedAt: "e.joined_at",
  designation: "e.designation",
  department: "d.name",
} as const;

function buildWhere(scope: TenantScope, filters: Partial<EmployeeQuery>): WhereBuilder {
  const where = new WhereBuilder();

  where.add("e.organization_id = $", scope.organizationId);
  where.add("e.deleted_at IS NULL");

  where.addIf(Boolean(filters.status), "e.status = $", filters.status);
  where.addIf(Boolean(filters.departmentId), "e.department_id = $", filters.departmentId);
  where.addIf(Boolean(filters.officeId), "e.primary_office_id = $", filters.officeId);
  where.addIf(Boolean(filters.managerId), "e.manager_id = $", filters.managerId);
  where.addIf(Boolean(filters.employmentType), "e.employment_type = $", filters.employmentType);

  where.addIf(
    Boolean(filters.teamId),
    "EXISTS (SELECT 1 FROM team_members tm WHERE tm.employee_id = e.id AND tm.team_id = $)",
    filters.teamId,
  );

  if (filters.search) {
    // ILIKE with a leading wildcard, served by the trigram indexes from
    // migration 015.
    //
    // `likePattern` escapes % and _ in the term. Parameterising the value
    // prevents SQL injection but does NOT stop those characters acting as
    // wildcards inside the pattern — without escaping, searching for "%"
    // returns every employee.
    const pattern = likePattern(filters.search);
    where.add(
      `(e.first_name ILIKE $ ESCAPE '\'
        OR e.last_name ILIKE $ ESCAPE '\'
        OR e.email ILIKE $ ESCAPE '\'
        OR e.employee_code ILIKE $ ESCAPE '\'
        OR e.designation ILIKE $ ESCAPE '\'
        OR (e.first_name || ' ' || e.last_name) ILIKE $ ESCAPE '\')`,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
    );
  }

  return where;
}

export const sqlEmployeeRepository = {
  async list(scope: TenantScope, filters: EmployeeQuery): Promise<Paginated<EmployeeSummary>> {
    const executor = exec(scope);
    const where = buildWhere(scope, filters);
    const clause = where.clause();

    const column = SORT_COLUMNS[assertIdentifier(filters.sortBy, Object.keys(SORT_COLUMNS) as Array<keyof typeof SORT_COLUMNS>, "name")];
    const direction = sortDirection(filters.sortOrder);
    const { limit, offset } = limitOffset(filters.page, filters.pageSize);

    // NULLS LAST so employees with no department do not lead a name sort.
    const orderBy = `${column} ${direction} NULLS LAST, e.first_name ASC, e.id ASC`;

    const listParams = [...where.params(), limit, offset];

    const [rows, total] = await Promise.all([
      query<SummaryRow>(
        `SELECT ${SUMMARY_COLUMNS}
           FROM ${SUMMARY_FROM}
           ${clause}
           ORDER BY ${orderBy}
           LIMIT $${where.params().length + 1} OFFSET $${where.params().length + 2}`,
        listParams,
        executor,
      ),
      count(`SELECT count(*) FROM ${SUMMARY_FROM} ${clause}`, where.params(), executor),
    ]);

    return paginate(rows.map(mapSummary), total, filters.page, limit);
  },

  /** Every active employee, for pickers and org charts. */
  async listAll(scope: TenantScope, activeOnly = true): Promise<EmployeeSummary[]> {
    const where = new WhereBuilder();
    where.add("e.organization_id = $", scope.organizationId);
    where.add("e.deleted_at IS NULL");
    where.addIf(activeOnly, "e.status = 'ACTIVE'");

    const rows = await query<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS}
         FROM ${SUMMARY_FROM}
         ${where.clause()}
         ORDER BY e.first_name ASC, e.last_name ASC`,
      where.params(),
      exec(scope),
    );

    return rows.map(mapSummary);
  },

  async findById(scope: TenantScope, id: string): Promise<EmployeeDetail | null> {
    const executor = exec(scope);

    const row = await queryOne<
      SummaryRow & {
        bio: string | null;
        exited_at: Date | null;
        shift_start_minutes: number | null;
        shift_end_minutes: number | null;
        created_at: Date;
        updated_at: Date;
      }
    >(
      `SELECT ${SUMMARY_COLUMNS},
              e.bio, e.exited_at, e.shift_start_minutes, e.shift_end_minutes,
              e.created_at, e.updated_at
         FROM ${SUMMARY_FROM}
        WHERE e.id = $1 AND e.organization_id = $2 AND e.deleted_at IS NULL`,
      [id, scope.organizationId],
      executor,
    );

    if (!row) return null;

    // Three small follow-up queries rather than one wide join: joining reports,
    // teams and offices together would multiply rows and need de-duplicating
    // in JavaScript, which is slower and easier to get wrong than three
    // indexed lookups.
    const [reports, memberships, officeAccess] = await Promise.all([
      query<{
        id: string;
        first_name: string;
        last_name: string;
        avatar_url: string | null;
        designation: string;
      }>(
        `SELECT id, first_name, last_name, avatar_url, designation
           FROM employees
          WHERE manager_id = $1 AND organization_id = $2 AND deleted_at IS NULL
          ORDER BY first_name ASC`,
        [id, scope.organizationId],
        executor,
      ),
      query<{
        role_label: string | null;
        team_id: string;
        team_name: string;
        team_slug: string;
        team_color: string;
      }>(
        `SELECT tm.role_label, t.id AS team_id, t.name AS team_name,
                t.slug AS team_slug, t.color AS team_color
           FROM team_members tm
           JOIN teams t ON t.id = tm.team_id
          WHERE tm.employee_id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL
          ORDER BY t.name ASC`,
        [id, scope.organizationId],
        executor,
      ),
      query<{ office_id: string; office_name: string; office_city: string }>(
        `SELECT o.id AS office_id, o.name AS office_name, o.city AS office_city
           FROM employee_offices eo
           JOIN offices o ON o.id = eo.office_id
          WHERE eo.employee_id = $1 AND o.organization_id = $2 AND o.deleted_at IS NULL
          ORDER BY o.name ASC`,
        [id, scope.organizationId],
        executor,
      ),
    ]);

    return {
      ...mapSummary(row),
      bio: row.bio,
      exitedAt: row.exited_at,
      shiftStartMinutes: row.shift_start_minutes,
      shiftEndMinutes: row.shift_end_minutes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reports: reports.map((report) => ({
        id: report.id,
        firstName: report.first_name,
        lastName: report.last_name,
        avatarUrl: report.avatar_url,
        designation: report.designation,
      })),
      teamMemberships: memberships.map((membership) => ({
        roleLabel: membership.role_label,
        team: {
          id: membership.team_id,
          name: membership.team_name,
          slug: membership.team_slug,
          color: membership.team_color,
        },
      })),
      officeAccess: officeAccess.map((access) => ({
        office: { id: access.office_id, name: access.office_name, city: access.office_city },
      })),
    };
  },

  async requireById(scope: TenantScope, id: string): Promise<EmployeeDetail> {
    return assertFound(await this.findById(scope, id), "employee");
  },

  /**
   * A manager's whole report tree, not just direct reports.
   *
   * A recursive CTE does in one round trip what the Prisma version did in up
   * to ten. `WHERE NOT id = ANY(path)` breaks cycles: a corrupt reporting loop
   * would otherwise recurse until the connection died.
   */
  async listReportIds(scope: TenantScope, managerId: string): Promise<string[]> {
    const rows = await query<{ id: string }>(
      `WITH RECURSIVE tree AS (
         SELECT id, ARRAY[id] AS path
           FROM employees
          WHERE manager_id = $1 AND organization_id = $2 AND deleted_at IS NULL

         UNION ALL

         SELECT e.id, tree.path || e.id
           FROM employees e
           JOIN tree ON e.manager_id = tree.id
          WHERE e.organization_id = $2
            AND e.deleted_at IS NULL
            AND NOT e.id = ANY(tree.path)
            AND array_length(tree.path, 1) < 20
       )
       SELECT DISTINCT id FROM tree`,
      [managerId, scope.organizationId],
      exec(scope),
    );

    return rows.map((row) => row.id);
  },

  async create(
    scope: TenantScope,
    data: {
      employeeCode: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      avatarUrl: string | null;
      designation: string;
      bio: string | null;
      departmentId: string | null;
      managerId: string | null;
      primaryOfficeId: string | null;
      employmentType: EmploymentType;
      status: EmployeeStatus;
      joinedAt: Date;
      exitedAt: Date | null;
      shiftStartMinutes: number | null;
      shiftEndMinutes: number | null;
      userId?: string | null;
    },
  ): Promise<EmployeeDetail> {
    const row = await queryExactlyOne<{ id: string }>(
      `INSERT INTO employees (
         organization_id, employee_code, user_id, first_name, last_name, email,
         phone, avatar_url, designation, bio, department_id, manager_id,
         primary_office_id, employment_type, status, joined_at, exited_at,
         shift_start_minutes, shift_end_minutes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        scope.organizationId,
        data.employeeCode,
        data.userId ?? null,
        data.firstName,
        data.lastName,
        data.email,
        data.phone,
        data.avatarUrl,
        data.designation,
        data.bio,
        data.departmentId,
        data.managerId,
        data.primaryOfficeId,
        data.employmentType,
        data.status,
        data.joinedAt,
        data.exitedAt,
        data.shiftStartMinutes,
        data.shiftEndMinutes,
      ],
      exec(scope),
    );

    return this.requireById(scope, row.id);
  },

  /**
   * Partial update.
   *
   * The SET list is assembled from the fields actually supplied, so an
   * unspecified field is left alone rather than overwritten with undefined.
   * Column names come from a fixed map — never from the caller.
   */
  async update(
    scope: TenantScope,
    id: string,
    data: Partial<{
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      avatarUrl: string | null;
      designation: string;
      bio: string | null;
      departmentId: string | null;
      managerId: string | null;
      primaryOfficeId: string | null;
      employmentType: EmploymentType;
      status: EmployeeStatus;
      joinedAt: Date;
      exitedAt: Date | null;
      shiftStartMinutes: number | null;
      shiftEndMinutes: number | null;
    }>,
  ): Promise<EmployeeDetail> {
    const COLUMNS: Record<string, string> = {
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      avatarUrl: "avatar_url",
      designation: "designation",
      bio: "bio",
      departmentId: "department_id",
      managerId: "manager_id",
      primaryOfficeId: "primary_office_id",
      employmentType: "employment_type",
      status: "status",
      joinedAt: "joined_at",
      exitedAt: "exited_at",
      shiftStartMinutes: "shift_start_minutes",
      shiftEndMinutes: "shift_end_minutes",
    };

    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(COLUMNS)) {
      if (!(key in data)) continue;
      params.push((data as Record<string, unknown>)[key]);
      assignments.push(`${column} = $${params.length}`);
    }

    if (assignments.length === 0) return this.requireById(scope, id);

    params.push(id, scope.organizationId);

    const affected = await execute(
      `UPDATE employees
          SET ${assignments.join(", ")}
        WHERE id = $${params.length - 1}
          AND organization_id = $${params.length}
          AND deleted_at IS NULL`,
      params,
      exec(scope),
    );

    // Zero rows means the id belongs to another tenant, or does not exist.
    // Both are 404 — see the note at the top of db/tenant.ts.
    if (affected === 0) throw assertFound(null, "employee");

    return this.requireById(scope, id);
  },

  /** Soft delete: attendance and task history are deliberately preserved. */
  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const affected = await execute(
      `UPDATE employees
          SET deleted_at = NOW(), status = 'INACTIVE'
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, scope.organizationId],
      exec(scope),
    );

    return affected > 0;
  },

  async countByStatus(scope: TenantScope): Promise<Array<{ status: EmployeeStatus; count: number }>> {
    const rows = await query<{ status: EmployeeStatus; count: string }>(
      `SELECT status, count(*) AS count
         FROM employees
        WHERE organization_id = $1 AND deleted_at IS NULL
        GROUP BY status`,
      [scope.organizationId],
      exec(scope),
    );

    return rows.map((row) => ({ status: row.status, count: toCount(row.count) }));
  },

  async countByDepartment(
    scope: TenantScope,
  ): Promise<Array<{ departmentId: string | null; name: string; color: string; count: number }>> {
    // One grouped join replaces the Prisma version's groupBy plus a second
    // lookup to resolve department names.
    const rows = await query<{
      department_id: string | null;
      name: string | null;
      color: string | null;
      count: string;
    }>(
      `SELECT e.department_id, d.name, d.color, count(*) AS count
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.organization_id = $1 AND e.deleted_at IS NULL AND e.status = 'ACTIVE'
        GROUP BY e.department_id, d.name, d.color
        ORDER BY count DESC`,
      [scope.organizationId],
      exec(scope),
    );

    return rows.map((row) => ({
      departmentId: row.department_id,
      name: row.name ?? "Unassigned",
      color: row.color ?? "#94a3b8",
      count: toCount(row.count),
    }));
  },

  async isCodeTaken(scope: TenantScope, employeeCode: string, exceptId?: string): Promise<boolean> {
    const found = await queryOne<{ id: string }>(
      `SELECT id FROM employees
        WHERE organization_id = $1 AND employee_code = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        LIMIT 1`,
      [scope.organizationId, employeeCode, exceptId ?? null],
      exec(scope),
    );

    return found !== null;
  },

  async isEmailTaken(scope: TenantScope, email: string, exceptId?: string): Promise<boolean> {
    const found = await queryOne<{ id: string }>(
      `SELECT id FROM employees
        WHERE organization_id = $1 AND email = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        LIMIT 1`,
      [scope.organizationId, email, exceptId ?? null],
      exec(scope),
    );

    return found !== null;
  },
};
