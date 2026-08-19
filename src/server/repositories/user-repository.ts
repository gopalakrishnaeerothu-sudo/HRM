import "server-only";

import {
  count,
  execute,
  likePattern,
  query,
  queryExactlyOne,
  queryOne,
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
import type { UserRole, UserStatus } from "@/server/db/types";

/**
 * User accounts and their access state, in plain SQL.
 *
 * Every statement carries `organization_id = $n`, including the writes. That
 * matters more here than anywhere else in the codebase: these are the
 * statements that grant and withdraw access, so an unscoped UPDATE would not
 * merely leak a row, it would let one tenant's administrator re-role another
 * tenant's staff. There is no function here that takes a bare user id and
 * returns or modifies a row.
 *
 * The one deliberate exception is `findOrganizationByJoinCode`, which runs
 * before any tenant is known — resolving the code *is* how the tenant is
 * chosen. It is on `organizations`, touches no user, and is commented below.
 */

// ---------------------------------------------------------------------------
// Shapes returned to the service layer
// ---------------------------------------------------------------------------

export interface AccessUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  provider: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  statusChangedAt: Date | null;
  statusReason: string | null;
  /** Whether the account can sign in with a password at all. */
  hasPassword: boolean;
  lockedUntil: Date | null;
  /** Null when this account has no staff profile yet — a signup always does. */
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation: string;
    departmentId: string | null;
    departmentName: string | null;
  } | null;
  statusChangedBy: { id: string; name: string } | null;
  /** Live sessions, so the table can offer "revoke" only when there is one. */
  activeSessions: number;
}

export interface AccessStats {
  total: number;
  pending: number;
  active: number;
  disabled: number;
  locked: number;
  rejected: number;
  invited: number;
  managers: number;
  hrAdmins: number;
}

interface AccessUserRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  provider: string;
  last_login_at: Date | null;
  created_at: Date;
  status_changed_at: Date | null;
  status_reason: string | null;
  has_password: boolean;
  locked_until: Date | null;
  employee_id: string | null;
  employee_code: string | null;
  first_name: string | null;
  last_name: string | null;
  designation: string | null;
  department_id: string | null;
  department_name: string | null;
  changed_by_id: string | null;
  changed_by_name: string | null;
  active_sessions: string | number;
}

/**
 * `password_hash` is reduced to a boolean in SQL rather than selected and
 * inspected in TypeScript. The hash then never enters the application's memory
 * on a path whose whole purpose is to be rendered in a table.
 */
const ACCESS_USER_SELECT = `
  u.id,
  u.email,
  u.name,
  u.phone,
  u.avatar_url,
  u.role,
  u.status,
  u.provider,
  u.last_login_at,
  u.created_at,
  u.status_changed_at,
  u.status_reason,
  (u.password_hash IS NOT NULL) AS has_password,
  u.locked_until,
  e.id            AS employee_id,
  e.employee_code,
  e.first_name,
  e.last_name,
  e.designation,
  e.department_id,
  d.name          AS department_name,
  actor.id        AS changed_by_id,
  actor.name      AS changed_by_name,
  (SELECT count(*) FROM sessions s
    WHERE s.user_id = u.id
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()) AS active_sessions
`;

const ACCESS_USER_FROM = `
  users u
  LEFT JOIN employees   e     ON e.user_id = u.id AND e.deleted_at IS NULL
  LEFT JOIN departments d     ON d.id = e.department_id
  LEFT JOIN users       actor ON actor.id = u.status_changed_by
`;

function toAccessUser(row: AccessUserRow): AccessUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    provider: row.provider,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    statusChangedAt: row.status_changed_at,
    statusReason: row.status_reason,
    hasPassword: row.has_password,
    lockedUntil: row.locked_until,
    employee: row.employee_id
      ? {
          id: row.employee_id,
          employeeCode: row.employee_code!,
          firstName: row.first_name!,
          lastName: row.last_name!,
          designation: row.designation!,
          departmentId: row.department_id,
          departmentName: row.department_name,
        }
      : null,
    statusChangedBy: row.changed_by_id
      ? { id: row.changed_by_id, name: row.changed_by_name! }
      : null,
    activeSessions:
      typeof row.active_sessions === "number"
        ? row.active_sessions
        : Number.parseInt(row.active_sessions, 10),
  };
}

export interface AccessUserQuery {
  status?: UserStatus | null;
  role?: UserRole | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export const userRepository = {
  /** The access table. Soft-deleted accounts are never listed. */
  async list(scope: TenantScope, filters: AccessUserQuery = {}): Promise<Paginated<AccessUser>> {
    const where = new WhereBuilder();
    where.add("u.organization_id = $", scope.organizationId);
    where.add("u.deleted_at IS NULL");
    where.addIf(Boolean(filters.status), "u.status = $::user_status", filters.status);
    where.addIf(Boolean(filters.role), "u.role = $::user_role", filters.role);

    if (filters.search?.trim()) {
      // ESCAPE '\' pairs with likePattern, so a literal % someone types is
      // searched for rather than matching every row.
      where.add(
        `(u.name ILIKE $ ESCAPE '\\' OR u.email ILIKE $ ESCAPE '\\')`,
        likePattern(filters.search.trim()),
        likePattern(filters.search.trim()),
      );
    }

    const clause = where.clause();
    const { limit, offset } = limitOffset(filters.page ?? 1, filters.pageSize ?? 25);

    const rowsPromise = query<AccessUserRow>(
      `SELECT ${ACCESS_USER_SELECT}
         FROM ${ACCESS_USER_FROM}
         ${clause}
         ORDER BY
           -- Pending first: the queue is the reason to open this page.
           (u.status = 'PENDING') DESC,
           u.created_at DESC
         LIMIT $${where.nextIndex()} OFFSET $${where.nextIndex() + 1}`,
      [...where.params(), limit, offset],
      exec(scope),
    );

    const totalPromise = count(
      `SELECT count(*) FROM ${ACCESS_USER_FROM} ${clause}`,
      where.params(),
      exec(scope),
    );

    const [rows, total] = await Promise.all([rowsPromise, totalPromise]);

    return paginate(rows.map(toAccessUser), total, Math.max(1, filters.page ?? 1), limit);
  },

  /**
   * The header tiles, in one round trip.
   *
   * FILTER rather than nine separate COUNT queries: the page renders all of
   * them together, and one sequential scan is cheaper than nine.
   */
  async stats(scope: TenantScope): Promise<AccessStats> {
    const row = await queryExactlyOne<Record<string, string | number>>(
      `SELECT count(*)                                          AS total,
              count(*) FILTER (WHERE status = 'PENDING')        AS pending,
              count(*) FILTER (WHERE status = 'ACTIVE')         AS active,
              count(*) FILTER (WHERE status = 'DISABLED')       AS disabled,
              count(*) FILTER (WHERE status = 'LOCKED')         AS locked,
              count(*) FILTER (WHERE status = 'REJECTED')       AS rejected,
              count(*) FILTER (WHERE status = 'INVITED')        AS invited,
              count(*) FILTER (WHERE role = 'MANAGER')          AS managers,
              count(*) FILTER (WHERE role IN ('HR', 'ADMIN'))   AS hr_admins
         FROM users
        WHERE organization_id = $1 AND deleted_at IS NULL`,
      [scope.organizationId],
      exec(scope),
    );

    const read = (key: string): number => {
      const value = row[key];
      return typeof value === "number" ? value : Number.parseInt(String(value ?? 0), 10);
    };

    return {
      total: read("total"),
      pending: read("pending"),
      active: read("active"),
      disabled: read("disabled"),
      locked: read("locked"),
      rejected: read("rejected"),
      invited: read("invited"),
      managers: read("managers"),
      hrAdmins: read("hr_admins"),
    };
  },

  async findById(scope: TenantScope, userId: string): Promise<AccessUser | null> {
    const row = await queryOne<AccessUserRow>(
      `SELECT ${ACCESS_USER_SELECT}
         FROM ${ACCESS_USER_FROM}
        WHERE u.id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`,
      [userId, scope.organizationId],
      exec(scope),
    );

    return row ? toAccessUser(row) : null;
  },

  async requireById(scope: TenantScope, userId: string): Promise<AccessUser> {
    return assertFound(await this.findById(scope, userId), "user");
  },

  /** How many accounts still hold a given role — used before demoting the last owner. */
  async countByRole(scope: TenantScope, role: UserRole): Promise<number> {
    return count(
      `SELECT count(*) FROM users
        WHERE organization_id = $1 AND role = $2::user_role
          AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [scope.organizationId, role],
      exec(scope),
    );
  },

  /**
   * Create an account.
   *
   * `role` and `status` are parameters rather than defaults because both
   * callers — self-signup and administrator invite — are explicit about them,
   * and a default here would be a silent answer to the question this whole
   * feature exists to ask. The service layer, not this function, decides what
   * they are allowed to be.
   *
   * Returns null when the email is already taken in this tenant, rather than
   * throwing: the caller turns that into a field error on the form.
   */
  async create(
    scope: TenantScope,
    input: {
      email: string;
      name: string;
      phone?: string | null;
      role: UserRole;
      status: UserStatus;
      passwordHash?: string | null;
      provider?: "DEV" | "PASSWORD";
    },
  ): Promise<{ id: string } | null> {
    const rows = await query<{ id: string }>(
      `INSERT INTO users (organization_id, email, name, phone, role, status,
                          password_hash, password_updated_at, provider,
                          status_changed_at)
       VALUES ($1, $2, $3, $4, $5::user_role, $6::user_status, $7,
               CASE WHEN $7::text IS NULL THEN NULL ELSE NOW() END,
               $8::auth_provider, NOW())
       -- Case-insensitive, matching users_email_lower_unique_per_org. The
       -- case-sensitive constraint would let alice@ and Alice@ both through.
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        scope.organizationId,
        input.email,
        input.name,
        input.phone ?? null,
        input.role,
        input.status,
        input.passwordHash ?? null,
        input.provider ?? (input.passwordHash ? "PASSWORD" : "DEV"),
      ],
      exec(scope),
    );

    return rows[0] ?? null;
  },

  /** Whether an address is already in use in this tenant, case-insensitively. */
  async emailExists(scope: TenantScope, email: string): Promise<boolean> {
    const row = await queryOne<{ one: number }>(
      `SELECT 1 AS one FROM users
        WHERE organization_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL
        LIMIT 1`,
      [scope.organizationId, email],
      exec(scope),
    );
    return row !== null;
  },

  /**
   * Move an account to a new status.
   *
   * `expectedStatus` makes the transition a compare-and-set: two administrators
   * clicking Approve and Reject on the same request produce one decision and
   * one refusal, rather than whichever UPDATE ran last silently winning.
   * Returns false when the row was not in the expected state.
   *
   * `LOCKED` bookkeeping is cleared on any move to ACTIVE, so approving or
   * re-enabling an account that had been locked out does not leave a stale
   * `locked_until` that immediately refuses the next sign-in.
   */
  async setStatus(
    scope: TenantScope,
    userId: string,
    next: {
      status: UserStatus;
      actorUserId: string | null;
      reason?: string | null;
      expectedStatus?: UserStatus | readonly UserStatus[] | null;
    },
  ): Promise<boolean> {
    const expected =
      next.expectedStatus == null
        ? null
        : Array.isArray(next.expectedStatus)
          ? [...next.expectedStatus]
          : [next.expectedStatus as UserStatus];

    const affected = await execute(
      `UPDATE users
          SET status            = $3::user_status,
              status_changed_at = NOW(),
              status_changed_by = $4,
              status_reason     = $5,
              failed_login_attempts = CASE WHEN $3::user_status = 'ACTIVE'
                                           THEN 0 ELSE failed_login_attempts END,
              locked_until          = CASE WHEN $3::user_status = 'ACTIVE'
                                           THEN NULL ELSE locked_until END
        WHERE id = $1
          AND organization_id = $2
          AND deleted_at IS NULL
          AND ($6::user_status[] IS NULL OR status = ANY($6::user_status[]))`,
      [
        userId,
        scope.organizationId,
        next.status,
        next.actorUserId,
        next.reason ?? null,
        expected,
      ],
      exec(scope),
    );

    return affected > 0;
  },

  /**
   * Change an account's role.
   *
   * Takes the role the caller believes the account currently holds, so a
   * decision made against a stale table cannot apply to a different one — the
   * administrator who loaded the page before someone else promoted this person
   * gets a refusal rather than an unintended demotion.
   */
  async setRole(
    scope: TenantScope,
    userId: string,
    next: { role: UserRole; expectedRole: UserRole },
  ): Promise<boolean> {
    const affected = await execute(
      `UPDATE users
          SET role = $3::user_role
        WHERE id = $1
          AND organization_id = $2
          AND deleted_at IS NULL
          AND role = $4::user_role`,
      [userId, scope.organizationId, next.role, next.expectedRole],
      exec(scope),
    );

    return affected > 0;
  },

  /**
   * Revoke every live session an account holds, scoped to the tenant.
   *
   * `revokeAllSessions` in the session store does the same by user id alone,
   * which is correct where it is called — the user is already resolved from
   * their own cookie. Here the id arrives from an administrator's request, so
   * the tenant check has to be part of the statement.
   */
  async revokeSessions(scope: TenantScope, userId: string, reason: string): Promise<number> {
    return execute(
      `UPDATE sessions s
          SET revoked_at = NOW(), revoked_reason = $3
        WHERE s.user_id = $1
          AND s.revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users u
             WHERE u.id = s.user_id AND u.organization_id = $2
          )`,
      [userId, scope.organizationId, reason],
      exec(scope),
    );
  },

  /**
   * Resolve a signup code to its organisation.
   *
   * The one function here that runs without a TenantScope, because it is what
   * *establishes* the scope: at signup there is no session and no tenant yet.
   * It reads only `organizations`, returns only the two fields the signup path
   * needs, and never takes a user id — so it cannot be repurposed into a
   * cross-tenant read.
   *
   * Normalisation matches the CHECK constraint in migration 018: upper-cased,
   * with the spaces and dashes people paste from an email stripped out.
   */
  async findOrganizationByJoinCode(
    rawCode: string,
  ): Promise<{ id: string; name: string } | null> {
    const code = rawCode.toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z0-9]{8,32}$/.test(code)) return null;

    return queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM organizations
        WHERE join_code = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [code],
    );
  },

  /** The tenant's own signup code, for the administrator to share or rotate. */
  async getJoinCode(scope: TenantScope): Promise<string | null> {
    const row = await queryOne<{ join_code: string | null }>(
      `SELECT join_code FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [scope.organizationId],
      exec(scope),
    );
    return row?.join_code ?? null;
  },

  /** Set or clear the signup code. Null turns self-signup off for the tenant. */
  async setJoinCode(scope: TenantScope, code: string | null): Promise<void> {
    await execute(
      `UPDATE organizations SET join_code = $2 WHERE id = $1 AND deleted_at IS NULL`,
      [scope.organizationId, code],
      exec(scope),
    );
  },
};
