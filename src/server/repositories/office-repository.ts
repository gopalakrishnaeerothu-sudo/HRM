import "server-only";

import type { GeofenceZone } from "@/server/geo/verify";
import { execute, query, queryExactlyOne, queryOne } from "@/server/db/query";
import { assertFound, exec, type TenantScope } from "@/server/db/tenant";
import { toCount, type OfficeStatus } from "@/server/db/types";

/**
 * Offices and their geofence zones, in plain SQL.
 *
 * The security-critical function here is `listZonesForEmployee`. It defines
 * the *authorisation envelope* for a check-in: the set of perimeters a given
 * employee is allowed to be verified against. The client never names an
 * office — the server derives the candidate set from the employee's own
 * assignments, which is what stops someone checking in against a perimeter
 * they have no relationship to.
 */

export interface GeofenceRecord {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isPrimary: boolean;
  isActive: boolean;
}

export interface OfficeRecord {
  id: string;
  name: string;
  code: string;
  addressLine: string;
  city: string;
  state: string | null;
  country: string;
  postalCode: string | null;
  timezone: string;
  latitude: number;
  longitude: number;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  gracePeriodMinutes: number;
  status: OfficeStatus;
  createdAt: Date;
  updatedAt: Date;
  geofences: GeofenceRecord[];
  /** Employees whose PRIMARY office this is. Blocks deletion when non-zero. */
  assignedEmployeeCount: number;
}

interface OfficeRow {
  id: string;
  name: string;
  code: string;
  address_line: string;
  city: string;
  state: string | null;
  country: string;
  postal_code: string | null;
  timezone: string;
  latitude: number;
  longitude: number;
  workday_start_minutes: number;
  workday_end_minutes: number;
  grace_period_minutes: number;
  status: OfficeStatus;
  created_at: Date;
  updated_at: Date;
  assigned_employee_count: string;
  /** Aggregated in SQL — see the note on the query. */
  geofences: GeofenceRecord[] | null;
}

/**
 * Offices and their zones in ONE query.
 *
 * `json_agg` over a lateral subquery returns each office's active zones as a
 * nested array, already camelCased by the aliases. The alternative — one query
 * for offices then another for zones, stitched in JavaScript — is two round
 * trips and a grouping loop for the same result.
 *
 * `FILTER (WHERE ...)` and the COALESCE matter: without them an office with no
 * active zone would come back with `[null]` rather than `[]`.
 */
const OFFICE_SELECT = `
  o.id, o.name, o.code, o.address_line, o.city, o.state, o.country,
  o.postal_code, o.timezone, o.latitude, o.longitude,
  o.workday_start_minutes, o.workday_end_minutes, o.grace_period_minutes,
  o.status, o.created_at, o.updated_at,
  (
    SELECT count(*) FROM employees emp
     WHERE emp.primary_office_id = o.id AND emp.deleted_at IS NULL
  ) AS assigned_employee_count,
  COALESCE(
    (
      SELECT json_agg(
               json_build_object(
                 'id', g.id,
                 'name', g.name,
                 'latitude', g.latitude,
                 'longitude', g.longitude,
                 'radiusMeters', g.radius_meters,
                 'isPrimary', g.is_primary,
                 'isActive', g.is_active
               )
               ORDER BY g.is_primary DESC, g.name ASC
             )
        FROM office_geofences g
       WHERE g.office_id = o.id AND g.is_active
    ),
    '[]'::json
  ) AS geofences
`;

function mapOffice(row: OfficeRow): OfficeRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    addressLine: row.address_line,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postal_code,
    timezone: row.timezone,
    latitude: row.latitude,
    longitude: row.longitude,
    workdayStartMinutes: row.workday_start_minutes,
    workdayEndMinutes: row.workday_end_minutes,
    gracePeriodMinutes: row.grace_period_minutes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    geofences: row.geofences ?? [],
    assignedEmployeeCount: toCount(row.assigned_employee_count),
  };
}

export const officeRepository = {
  async list(scope: TenantScope, includeInactive = true): Promise<OfficeRecord[]> {
    const rows = await query<OfficeRow>(
      `SELECT ${OFFICE_SELECT}
         FROM offices o
        WHERE o.organization_id = $1
          AND o.deleted_at IS NULL
          AND ($2::boolean OR o.status = 'ACTIVE')
        ORDER BY o.status ASC, o.name ASC`,
      [scope.organizationId, includeInactive],
      exec(scope),
    );

    return rows.map(mapOffice);
  },

  async findById(scope: TenantScope, id: string): Promise<OfficeRecord | null> {
    const row = await queryOne<OfficeRow>(
      `SELECT ${OFFICE_SELECT}
         FROM offices o
        WHERE o.id = $1 AND o.organization_id = $2 AND o.deleted_at IS NULL`,
      [id, scope.organizationId],
      exec(scope),
    );

    return row ? mapOffice(row) : null;
  },

  async requireById(scope: TenantScope, id: string): Promise<OfficeRecord> {
    return assertFound(await this.findById(scope, id), "office");
  },

  /**
   * The geofence zones an employee may check in from.
   *
   * Their primary office plus any additionally assigned ones, restricted to
   * ACTIVE offices with ACTIVE zones — and, crucially, to this tenant. An
   * employee id from another organisation yields an empty set rather than that
   * organisation's perimeters.
   *
   * Returning an empty array is meaningful: the verification engine treats it
   * as "no office assigned" and refuses the check-in rather than defaulting to
   * something permissive.
   */
  async listZonesForEmployee(scope: TenantScope, employeeId: string): Promise<GeofenceZone[]> {
    const rows = await query<{
      id: string;
      office_id: string;
      office_name: string;
      latitude: number;
      longitude: number;
      radius_meters: number;
    }>(
      `SELECT g.id, o.id AS office_id, o.name AS office_name,
              g.latitude, g.longitude, g.radius_meters
         FROM employees e
         JOIN offices o
           ON o.organization_id = e.organization_id
          AND o.deleted_at IS NULL
          AND o.status = 'ACTIVE'
          AND (
                o.id = e.primary_office_id
                OR EXISTS (
                     SELECT 1 FROM employee_offices eo
                      WHERE eo.employee_id = e.id AND eo.office_id = o.id
                   )
              )
         JOIN office_geofences g ON g.office_id = o.id AND g.is_active
        WHERE e.id = $1
          AND e.organization_id = $2
          AND e.deleted_at IS NULL
        ORDER BY g.is_primary DESC, o.name ASC`,
      [employeeId, scope.organizationId],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      officeId: row.office_id,
      officeName: row.office_name,
      latitude: row.latitude,
      longitude: row.longitude,
      radiusMeters: row.radius_meters,
    }));
  },

  /**
   * Create an office together with its primary perimeter, atomically.
   *
   * A CTE rather than two statements: an office without a geofence is a site
   * nobody can check in to, so the pair must not be separable — not even by a
   * crash between them.
   */
  async create(
    scope: TenantScope,
    data: {
      name: string;
      code: string;
      addressLine: string;
      city: string;
      state: string | null;
      country: string;
      postalCode: string | null;
      timezone: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      workdayStartMinutes: number;
      workdayEndMinutes: number;
      gracePeriodMinutes: number;
      status: OfficeStatus;
    },
  ): Promise<OfficeRecord> {
    const created = await queryExactlyOne<{ id: string }>(
      `WITH new_office AS (
         INSERT INTO offices (
           organization_id, name, code, address_line, city, state, country,
           postal_code, timezone, latitude, longitude,
           workday_start_minutes, workday_end_minutes, grace_period_minutes, status
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, latitude, longitude
       ),
       new_zone AS (
         INSERT INTO office_geofences (office_id, name, latitude, longitude, radius_meters, is_primary, is_active)
         SELECT id, 'Main perimeter', latitude, longitude, $16, TRUE, TRUE FROM new_office
         RETURNING office_id
       )
       SELECT id FROM new_office`,
      [
        scope.organizationId,
        data.name,
        data.code,
        data.addressLine,
        data.city,
        data.state,
        data.country,
        data.postalCode,
        data.timezone,
        data.latitude,
        data.longitude,
        data.workdayStartMinutes,
        data.workdayEndMinutes,
        data.gracePeriodMinutes,
        data.status,
        data.radiusMeters,
      ],
      exec(scope),
    );

    return this.requireById(scope, created.id);
  },

  async update(
    scope: TenantScope,
    id: string,
    data: Partial<{
      name: string;
      addressLine: string;
      city: string;
      state: string | null;
      country: string;
      postalCode: string | null;
      timezone: string;
      latitude: number;
      longitude: number;
      workdayStartMinutes: number;
      workdayEndMinutes: number;
      gracePeriodMinutes: number;
      status: OfficeStatus;
    }>,
  ): Promise<OfficeRecord | null> {
    const COLUMNS: Record<string, string> = {
      name: "name",
      addressLine: "address_line",
      city: "city",
      state: "state",
      country: "country",
      postalCode: "postal_code",
      timezone: "timezone",
      latitude: "latitude",
      longitude: "longitude",
      workdayStartMinutes: "workday_start_minutes",
      workdayEndMinutes: "workday_end_minutes",
      gracePeriodMinutes: "grace_period_minutes",
      status: "status",
    };

    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(COLUMNS)) {
      if (!(key in data)) continue;
      params.push((data as Record<string, unknown>)[key]);
      assignments.push(`${column} = $${params.length}`);
    }

    if (assignments.length === 0) return this.findById(scope, id);

    params.push(id, scope.organizationId);

    const affected = await execute(
      `UPDATE offices
          SET ${assignments.join(", ")}
        WHERE id = $${params.length - 1}
          AND organization_id = $${params.length}
          AND deleted_at IS NULL`,
      params,
      exec(scope),
    );

    if (affected === 0) return null;
    return this.findById(scope, id);
  },

  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const affected = await execute(
      `UPDATE offices
          SET deleted_at = NOW(), status = 'INACTIVE'
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, scope.organizationId],
      exec(scope),
    );

    return affected > 0;
  },

  async countAssignedEmployees(scope: TenantScope, officeId: string): Promise<number> {
    const row = await queryOne<{ count: string }>(
      `SELECT count(*) AS count
         FROM employees
        WHERE primary_office_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [officeId, scope.organizationId],
      exec(scope),
    );

    return toCount(row?.count);
  },

  async isCodeTaken(scope: TenantScope, code: string, exceptId?: string): Promise<boolean> {
    const found = await queryOne<{ id: string }>(
      `SELECT id FROM offices
        WHERE organization_id = $1 AND code = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        LIMIT 1`,
      [scope.organizationId, code, exceptId ?? null],
      exec(scope),
    );

    return found !== null;
  },

  // --- Geofence zones -------------------------------------------------------

  /**
   * A zone is tenant-scoped through its office — the table has no
   * organization_id of its own, so the join IS the security boundary.
   */
  async findGeofence(
    scope: TenantScope,
    geofenceId: string,
  ): Promise<(GeofenceRecord & { officeId: string; officeName: string }) | null> {
    const row = await queryOne<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      radius_meters: number;
      is_primary: boolean;
      is_active: boolean;
      office_id: string;
      office_name: string;
    }>(
      `SELECT g.id, g.name, g.latitude, g.longitude, g.radius_meters,
              g.is_primary, g.is_active, o.id AS office_id, o.name AS office_name
         FROM office_geofences g
         JOIN offices o ON o.id = g.office_id
        WHERE g.id = $1 AND o.organization_id = $2 AND o.deleted_at IS NULL`,
      [geofenceId, scope.organizationId],
      exec(scope),
    );

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      radiusMeters: row.radius_meters,
      isPrimary: row.is_primary,
      isActive: row.is_active,
      officeId: row.office_id,
      officeName: row.office_name,
    };
  },

  async createGeofence(
    scope: TenantScope,
    officeId: string,
    data: { name: string; latitude: number; longitude: number; radiusMeters: number; isPrimary: boolean; isActive: boolean },
  ): Promise<string> {
    // Confirms the office is in this tenant before inserting a child row.
    await this.requireById(scope, officeId);

    const row = await queryExactlyOne<{ id: string }>(
      `INSERT INTO office_geofences (office_id, name, latitude, longitude, radius_meters, is_primary, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [officeId, data.name, data.latitude, data.longitude, data.radiusMeters, data.isPrimary, data.isActive],
      exec(scope),
    );

    return row.id;
  },

  async updateGeofence(
    scope: TenantScope,
    geofenceId: string,
    // Partial: callers legitimately change one field — resizing a perimeter is
    // the common case — and requiring all six invites a caller to re-send
    // stale values it read some time ago.
    data: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      isPrimary?: boolean;
      isActive?: boolean;
    },
  ): Promise<boolean> {
    const affected = await execute(
      `UPDATE office_geofences g
          SET name          = COALESCE($3, g.name),
              latitude      = COALESCE($4, g.latitude),
              longitude     = COALESCE($5, g.longitude),
              radius_meters = COALESCE($6, g.radius_meters),
              is_primary    = COALESCE($7, g.is_primary),
              is_active     = COALESCE($8, g.is_active)
         FROM offices o
        WHERE g.office_id = o.id
          AND g.id = $1
          AND o.organization_id = $2
          AND o.deleted_at IS NULL`,
      [
        geofenceId,
        scope.organizationId,
        data.name ?? null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.radiusMeters ?? null,
        data.isPrimary ?? null,
        data.isActive ?? null,
      ],
      exec(scope),
    );

    return affected > 0;
  },

  /**
   * Demote every other zone on an office.
   *
   * Migration 003 enforces at most one primary zone with a partial unique
   * index, so promoting a new primary without demoting the old one would fail.
   * This runs first.
   */
  async clearPrimaryFlag(scope: TenantScope, officeId: string, exceptId?: string): Promise<void> {
    await execute(
      `UPDATE office_geofences g
          SET is_primary = FALSE
         FROM offices o
        WHERE g.office_id = o.id
          AND g.office_id = $1
          AND o.organization_id = $2
          AND g.is_primary
          AND ($3::uuid IS NULL OR g.id <> $3::uuid)`,
      [officeId, scope.organizationId, exceptId ?? null],
      exec(scope),
    );
  },

  /** Deactivate rather than delete, so historical events keep their reference. */
  async deleteGeofence(scope: TenantScope, geofenceId: string): Promise<boolean> {
    const affected = await execute(
      `UPDATE office_geofences g
          SET is_active = FALSE, is_primary = FALSE
         FROM offices o
        WHERE g.office_id = o.id
          AND g.id = $1
          AND o.organization_id = $2`,
      [geofenceId, scope.organizationId],
      exec(scope),
    );

    return affected > 0;
  },

  /** Active zones on an office. Used to refuse removing the last one. */
  async countActiveZones(scope: TenantScope, officeId: string): Promise<number> {
    const row = await queryOne<{ count: string }>(
      `SELECT count(*) AS count
         FROM office_geofences g
         JOIN offices o ON o.id = g.office_id
        WHERE g.office_id = $1 AND o.organization_id = $2 AND g.is_active`,
      [officeId, scope.organizationId],
      exec(scope),
    );

    return toCount(row?.count);
  },
};
