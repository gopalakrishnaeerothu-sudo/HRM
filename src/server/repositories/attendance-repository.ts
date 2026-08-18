import "server-only";

import { count, execute, query, queryExactlyOne, queryOne } from "@/server/db/query";
import { exec, limitOffset, paginate, type Paginated, type TenantScope } from "@/server/db/tenant";
import {
  nullableRelation,
  toCount,
  toNumber,
  toStringArray,
  type AttendanceEventType,
  type AttendanceSource,
  type AttendanceStatus,
  type LeaveType,
  type LocationVerification,
} from "@/server/db/types";

/**
 * Attendance records, breaks and the append-only location event log.
 *
 * Two things here differ from a routine CRUD port and are worth stating:
 *
 * 1. `upsertRecord` relies on `ON CONFLICT (employee_id, date)`. That unique
 *    constraint is what makes two simultaneous check-ins collapse into one
 *    row rather than racing to create two. The application does not need a
 *    lock; the constraint is the lock.
 *
 * 2. `createEvent` is called for refused attempts as well as accepted ones,
 *    and is never updated afterwards. A check-in rejected for being outside
 *    the perimeter produces no attendance record but does produce an event —
 *    which is the only reason repeated boundary probing is visible at all.
 */

/**
 * Midnight UTC of a calendar day.
 *
 * Which day a timestamp belongs to is decided by the attendance service using
 * the office's timezone; this only normalises an already-decided day so the
 * DATE column is stable regardless of where the query runs.
 */
export function toDateKey(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface AttendanceRecordRow {
  id: string;
  date: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  status: AttendanceStatus;
  workedMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
  lateByMinutes: number;
  earlyByMinutes: number;
  isManualEntry: boolean;
  overrideReason: string | null;
  notes: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    employeeCode: string;
    designation: string;
    department: { id: string; name: string; color: string } | null;
  };
  office: { id: string; name: string; city: string } | null;
}

interface RecordRow {
  id: string;
  date: Date;
  check_in_at: Date | null;
  check_out_at: Date | null;
  status: AttendanceStatus;
  worked_minutes: number;
  break_minutes: number;
  overtime_minutes: number;
  late_by_minutes: number;
  early_by_minutes: number;
  is_manual_entry: boolean;
  override_reason: string | null;
  notes: string | null;
  emp_id: string;
  emp_first_name: string;
  emp_last_name: string;
  emp_avatar_url: string | null;
  emp_code: string;
  emp_designation: string;
  dept_id: string | null;
  dept_name: string | null;
  dept_color: string | null;
  office_id: string | null;
  office_name: string | null;
  office_city: string | null;
}

const RECORD_SELECT = `
  a.id, a.date, a.check_in_at, a.check_out_at, a.status,
  a.worked_minutes, a.break_minutes, a.overtime_minutes,
  a.late_by_minutes, a.early_by_minutes,
  a.is_manual_entry, a.override_reason, a.notes,
  e.id AS emp_id, e.first_name AS emp_first_name, e.last_name AS emp_last_name,
  e.avatar_url AS emp_avatar_url, e.employee_code AS emp_code,
  e.designation AS emp_designation,
  d.id AS dept_id, d.name AS dept_name, d.color AS dept_color,
  o.id AS office_id, o.name AS office_name, o.city AS office_city
`;

const RECORD_FROM = `
  attendance_records a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN offices o ON o.id = a.office_id
`;

function mapRecord(row: RecordRow): AttendanceRecordRow {
  return {
    id: row.id,
    date: row.date,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    status: row.status,
    workedMinutes: row.worked_minutes,
    breakMinutes: row.break_minutes,
    overtimeMinutes: row.overtime_minutes,
    lateByMinutes: row.late_by_minutes,
    earlyByMinutes: row.early_by_minutes,
    isManualEntry: row.is_manual_entry,
    overrideReason: row.override_reason,
    notes: row.notes,
    employee: {
      id: row.emp_id,
      firstName: row.emp_first_name,
      lastName: row.emp_last_name,
      avatarUrl: row.emp_avatar_url,
      employeeCode: row.emp_code,
      designation: row.emp_designation,
      department: nullableRelation(row.dept_id, () => ({
        id: row.dept_id!,
        name: row.dept_name!,
        color: row.dept_color!,
      })),
    },
    office: nullableRelation(row.office_id, () => ({
      id: row.office_id!,
      name: row.office_name!,
      city: row.office_city!,
    })),
  };
}

export const attendanceRepository = {
  async findRecord(
    scope: TenantScope,
    employeeId: string,
    date: Date,
  ): Promise<AttendanceRecordRow | null> {
    const row = await queryOne<RecordRow>(
      `SELECT ${RECORD_SELECT}
         FROM ${RECORD_FROM}
        WHERE a.organization_id = $1 AND a.employee_id = $2 AND a.date = $3`,
      [scope.organizationId, employeeId, toDateKey(date)],
      exec(scope),
    );

    return row ? mapRecord(row) : null;
  },

  /**
   * Today's record with its breaks and events, for the personal dashboard.
   */
  async findRecordWithDetail(scope: TenantScope, employeeId: string, date: Date) {
    const record = await this.findRecord(scope, employeeId, date);
    if (!record) return null;

    const executor = exec(scope);

    const [breaks, events] = await Promise.all([
      query<{
        id: string;
        started_at: Date;
        ended_at: Date | null;
        minutes: number;
        reason: string | null;
      }>(
        `SELECT id, started_at, ended_at, minutes, reason
           FROM break_records
          WHERE attendance_record_id = $1 AND organization_id = $2
          ORDER BY started_at ASC`,
        [record.id, scope.organizationId],
        executor,
      ),
      query<{
        id: string;
        type: AttendanceEventType;
        occurred_at: Date;
        verification: LocationVerification;
        distance_meters: number | null;
        accuracy_meters: number | null;
        risk_flags: string[];
        office_id: string | null;
        office_name: string | null;
      }>(
        `SELECT ev.id, ev.type, ev.occurred_at, ev.verification,
                ev.distance_meters, ev.accuracy_meters, ev.risk_flags,
                o.id AS office_id, o.name AS office_name
           FROM attendance_events ev
           LEFT JOIN offices o ON o.id = ev.office_id
          WHERE ev.attendance_record_id = $1 AND ev.organization_id = $2
          ORDER BY ev.occurred_at ASC`,
        [record.id, scope.organizationId],
        executor,
      ),
    ]);

    return {
      ...record,
      breaks: breaks.map((entry) => ({
        id: entry.id,
        startedAt: entry.started_at,
        endedAt: entry.ended_at,
        minutes: entry.minutes,
        reason: entry.reason,
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        occurredAt: event.occurred_at,
        verification: event.verification,
        distanceMeters: event.distance_meters,
        accuracyMeters: event.accuracy_meters,
        riskFlags: toStringArray(event.risk_flags),
        office: nullableRelation(event.office_id, () => ({
          id: event.office_id!,
          name: event.office_name!,
        })),
      })),
    };
  },

  /**
   * Create or update the day's record.
   *
   * `ON CONFLICT (employee_id, date)` makes this atomic. Two concurrent
   * check-ins both reach the INSERT; one wins, the other falls through to the
   * UPDATE branch. Neither creates a duplicate, and no application-level lock
   * is involved.
   *
   * COALESCE on the update means a null in `update` leaves the existing value
   * alone rather than wiping it — a check-out must not erase the check-in.
   */
  async upsertRecord(
    scope: TenantScope,
    employeeId: string,
    date: Date,
    values: {
      officeId?: string | null;
      checkInAt?: Date | null;
      checkOutAt?: Date | null;
      status: AttendanceStatus;
      workedMinutes?: number;
      breakMinutes?: number;
      overtimeMinutes?: number;
      lateByMinutes?: number;
      earlyByMinutes?: number;
      isManualEntry?: boolean;
      overrideReason?: string | null;
      notes?: string | null;
    },
  ): Promise<AttendanceRecordRow> {
    const dateKey = toDateKey(date);

    const inserted = await queryExactlyOne<{ id: string }>(
      `INSERT INTO attendance_records (
         organization_id, employee_id, office_id, date, check_in_at, check_out_at,
         status, worked_minutes, break_minutes, overtime_minutes,
         late_by_minutes, early_by_minutes, is_manual_entry, override_reason, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               COALESCE($8,0), COALESCE($9,0), COALESCE($10,0),
               COALESCE($11,0), COALESCE($12,0), COALESCE($13,FALSE), $14, $15)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         office_id        = COALESCE(EXCLUDED.office_id, attendance_records.office_id),
         check_in_at      = COALESCE(EXCLUDED.check_in_at, attendance_records.check_in_at),
         check_out_at     = COALESCE(EXCLUDED.check_out_at, attendance_records.check_out_at),
         status           = EXCLUDED.status,
         worked_minutes   = EXCLUDED.worked_minutes,
         break_minutes    = EXCLUDED.break_minutes,
         overtime_minutes = EXCLUDED.overtime_minutes,
         late_by_minutes  = EXCLUDED.late_by_minutes,
         early_by_minutes = EXCLUDED.early_by_minutes,
         is_manual_entry  = EXCLUDED.is_manual_entry,
         override_reason  = COALESCE(EXCLUDED.override_reason, attendance_records.override_reason),
         notes            = COALESCE(EXCLUDED.notes, attendance_records.notes)
       RETURNING id`,
      [
        scope.organizationId,
        employeeId,
        values.officeId ?? null,
        dateKey,
        values.checkInAt ?? null,
        values.checkOutAt ?? null,
        values.status,
        values.workedMinutes ?? null,
        values.breakMinutes ?? null,
        values.overtimeMinutes ?? null,
        values.lateByMinutes ?? null,
        values.earlyByMinutes ?? null,
        values.isManualEntry ?? null,
        values.overrideReason ?? null,
        values.notes ?? null,
      ],
      exec(scope),
    );

    const record = await queryOne<RecordRow>(
      `SELECT ${RECORD_SELECT} FROM ${RECORD_FROM} WHERE a.id = $1 AND a.organization_id = $2`,
      [inserted.id, scope.organizationId],
      exec(scope),
    );

    return mapRecord(record!);
  },

  async list(
    scope: TenantScope,
    filters: {
      employeeIds?: readonly string[];
      officeId?: string;
      departmentId?: string;
      teamId?: string;
      status?: AttendanceStatus;
      from?: Date;
      to?: Date;
    },
    page: number,
    pageSize: number,
  ): Promise<Paginated<AttendanceRecordRow>> {
    const executor = exec(scope);
    const params: unknown[] = [scope.organizationId];
    const conditions = ["a.organization_id = $1"];

    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("$?", `$${params.length}`));
    };

    if (filters.employeeIds) add("a.employee_id = ANY($?::uuid[])", [...filters.employeeIds]);
    if (filters.officeId) add("a.office_id = $?", filters.officeId);
    if (filters.status) add("a.status = $?", filters.status);
    if (filters.departmentId) add("e.department_id = $?", filters.departmentId);
    if (filters.teamId) {
      add(
        "EXISTS (SELECT 1 FROM team_members tm WHERE tm.employee_id = e.id AND tm.team_id = $?)",
        filters.teamId,
      );
    }
    if (filters.from) add("a.date >= $?", toDateKey(filters.from));
    if (filters.to) add("a.date <= $?", toDateKey(filters.to));

    const where = `WHERE ${conditions.join(" AND ")}`;
    const { limit, offset } = limitOffset(page, pageSize);

    const [rows, total] = await Promise.all([
      query<RecordRow>(
        `SELECT ${RECORD_SELECT}
           FROM ${RECORD_FROM}
           ${where}
           ORDER BY a.date DESC, e.first_name ASC, a.id ASC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
        executor,
      ),
      count(`SELECT count(*) FROM ${RECORD_FROM} ${where}`, params, executor),
    ]);

    return paginate(rows.map(mapRecord), total, page, limit);
  },

  /** Unpaginated range read for calendars and charts. Bounded by date. */
  async listRange(
    scope: TenantScope,
    filters: { employeeIds?: readonly string[]; from: Date; to: Date },
  ) {
    const rows = await query<{
      id: string;
      date: Date;
      employee_id: string;
      status: AttendanceStatus;
      worked_minutes: number;
      overtime_minutes: number;
      late_by_minutes: number;
      check_in_at: Date | null;
      check_out_at: Date | null;
    }>(
      `SELECT id, date, employee_id, status, worked_minutes,
              overtime_minutes, late_by_minutes, check_in_at, check_out_at
         FROM attendance_records
        WHERE organization_id = $1
          AND ($2::uuid[] IS NULL OR employee_id = ANY($2::uuid[]))
          AND date BETWEEN $3 AND $4
        ORDER BY date ASC`,
      [
        scope.organizationId,
        filters.employeeIds ? [...filters.employeeIds] : null,
        toDateKey(filters.from),
        toDateKey(filters.to),
      ],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      employeeId: row.employee_id,
      status: row.status,
      workedMinutes: row.worked_minutes,
      overtimeMinutes: row.overtime_minutes,
      lateByMinutes: row.late_by_minutes,
      checkInAt: row.check_in_at,
      checkOutAt: row.check_out_at,
    }));
  },

  async countByStatusForDate(
    scope: TenantScope,
    date: Date,
    employeeIds?: readonly string[],
  ): Promise<Array<{ status: AttendanceStatus; count: number }>> {
    const rows = await query<{ status: AttendanceStatus; count: string }>(
      `SELECT status, count(*) AS count
         FROM attendance_records
        WHERE organization_id = $1
          AND date = $2
          AND ($3::uuid[] IS NULL OR employee_id = ANY($3::uuid[]))
        GROUP BY status`,
      [scope.organizationId, toDateKey(date), employeeIds ? [...employeeIds] : null],
      exec(scope),
    );

    return rows.map((row) => ({ status: row.status, count: toCount(row.count) }));
  },

  // --- Events (append-only) -------------------------------------------------

  async createEvent(
    scope: TenantScope,
    data: {
      employeeId: string;
      attendanceRecordId?: string | null;
      officeId?: string | null;
      geofenceId?: string | null;
      type: AttendanceEventType;
      occurredAt?: Date;
      latitude?: number | null;
      longitude?: number | null;
      accuracyMeters?: number | null;
      distanceMeters?: number | null;
      verification: LocationVerification;
      source?: AttendanceSource;
      riskFlags?: readonly string[];
      ipAddress?: string | null;
      userAgent?: string | null;
      deviceId?: string | null;
    },
  ): Promise<string> {
    const row = await queryExactlyOne<{ id: string }>(
      `INSERT INTO attendance_events (
         organization_id, employee_id, attendance_record_id, office_id, geofence_id,
         type, occurred_at, latitude, longitude, accuracy_meters, distance_meters,
         verification, source, risk_flags, ip_address, user_agent, device_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, NOW()),$8,$9,$10,$11,$12,
               COALESCE($13, 'WEB')::attendance_source,
               COALESCE($14, ARRAY[]::text[]),$15,$16,$17)
       RETURNING id`,
      [
        scope.organizationId,
        data.employeeId,
        data.attendanceRecordId ?? null,
        data.officeId ?? null,
        data.geofenceId ?? null,
        data.type,
        data.occurredAt ?? null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.accuracyMeters ?? null,
        data.distanceMeters ?? null,
        data.verification,
        data.source ?? null,
        data.riskFlags ? [...data.riskFlags] : null,
        data.ipAddress ?? null,
        data.userAgent ?? null,
        data.deviceId ?? null,
      ],
      exec(scope),
    );

    return row.id;
  },

  /**
   * The most recent ACCEPTED fix for an employee, for the impossible-travel
   * check. Only VERIFIED events count: a rejected fix must never become the
   * baseline the next comparison is measured against.
   */
  async findLastAcceptedFix(
    scope: TenantScope,
    employeeId: string,
  ): Promise<{ latitude: number; longitude: number; at: Date } | null> {
    const row = await queryOne<{ latitude: number; longitude: number; occurred_at: Date }>(
      `SELECT latitude, longitude, occurred_at
         FROM attendance_events
        WHERE organization_id = $1
          AND employee_id = $2
          AND verification = 'VERIFIED'
          AND latitude IS NOT NULL
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [scope.organizationId, employeeId],
      exec(scope),
    );

    if (!row) return null;
    return { latitude: row.latitude, longitude: row.longitude, at: row.occurred_at };
  },

  async countRecentEvents(
    scope: TenantScope,
    employeeId: string,
    sinceSeconds: number,
  ): Promise<number> {
    return count(
      `SELECT count(*) FROM attendance_events
        WHERE organization_id = $1
          AND employee_id = $2
          AND occurred_at >= NOW() - ($3 || ' seconds')::interval`,
      [scope.organizationId, employeeId, String(sinceSeconds)],
      exec(scope),
    );
  },

  /** Refused or flagged attempts, for the Location Review tab. */
  async listFlaggedEvents(scope: TenantScope, limit = 25) {
    const rows = await query<{
      id: string;
      type: AttendanceEventType;
      occurred_at: Date;
      verification: LocationVerification;
      distance_meters: number | null;
      accuracy_meters: number | null;
      risk_flags: string[];
      source: AttendanceSource;
      emp_id: string;
      emp_first_name: string;
      emp_last_name: string;
      emp_avatar_url: string | null;
      office_id: string | null;
      office_name: string | null;
    }>(
      `SELECT ev.id, ev.type, ev.occurred_at, ev.verification,
              ev.distance_meters, ev.accuracy_meters, ev.risk_flags, ev.source,
              e.id AS emp_id, e.first_name AS emp_first_name,
              e.last_name AS emp_last_name, e.avatar_url AS emp_avatar_url,
              o.id AS office_id, o.name AS office_name
         FROM attendance_events ev
         JOIN employees e ON e.id = ev.employee_id
         LEFT JOIN offices o ON o.id = ev.office_id
        WHERE ev.organization_id = $1
          AND (ev.verification IN ('SUSPECTED_SPOOF','OUTSIDE_GEOFENCE')
               OR ev.risk_flags <> ARRAY[]::text[])
        ORDER BY ev.occurred_at DESC
        LIMIT $2`,
      [scope.organizationId, limit],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      occurredAt: row.occurred_at,
      verification: row.verification,
      distanceMeters: row.distance_meters,
      accuracyMeters: row.accuracy_meters,
      riskFlags: toStringArray(row.risk_flags),
      source: row.source,
      employee: {
        id: row.emp_id,
        firstName: row.emp_first_name,
        lastName: row.emp_last_name,
        avatarUrl: row.emp_avatar_url,
      },
      office: nullableRelation(row.office_id, () => ({
        id: row.office_id!,
        name: row.office_name!,
      })),
    }));
  },

  // --- Breaks ---------------------------------------------------------------

  async findOpenBreak(scope: TenantScope, attendanceRecordId: string) {
    const row = await queryOne<{ id: string; started_at: Date }>(
      `SELECT id, started_at FROM break_records
        WHERE organization_id = $1 AND attendance_record_id = $2 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
      [scope.organizationId, attendanceRecordId],
      exec(scope),
    );

    return row ? { id: row.id, startedAt: row.started_at } : null;
  },

  async startBreak(
    scope: TenantScope,
    data: { employeeId: string; attendanceRecordId: string; startedAt: Date; reason?: string | null },
  ): Promise<string> {
    // Migration 007 permits only one open break per record, so a double-tap on
    // "take a break" raises rather than silently double-counting.
    const row = await queryExactlyOne<{ id: string }>(
      `INSERT INTO break_records (organization_id, employee_id, attendance_record_id, started_at, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [scope.organizationId, data.employeeId, data.attendanceRecordId, data.startedAt, data.reason ?? null],
      exec(scope),
    );

    return row.id;
  },

  async endBreak(scope: TenantScope, breakId: string, endedAt: Date, minutes: number): Promise<boolean> {
    const affected = await execute(
      `UPDATE break_records
          SET ended_at = $3, minutes = $4
        WHERE id = $1 AND organization_id = $2 AND ended_at IS NULL`,
      [breakId, scope.organizationId, endedAt, minutes],
      exec(scope),
    );

    return affected > 0;
  },

  async totalBreakMinutes(scope: TenantScope, attendanceRecordId: string): Promise<number> {
    const row = await queryOne<{ total: string | null }>(
      `SELECT COALESCE(SUM(minutes), 0) AS total
         FROM break_records
        WHERE organization_id = $1 AND attendance_record_id = $2`,
      [scope.organizationId, attendanceRecordId],
      exec(scope),
    );

    return toNumber(row?.total, 0);
  },

  // --- Holidays and leave ---------------------------------------------------

  async findHoliday(scope: TenantScope, date: Date) {
    return queryOne<{ id: string; name: string; is_optional: boolean }>(
      `SELECT id, name, is_optional FROM holidays
        WHERE organization_id = $1 AND date = $2 LIMIT 1`,
      [scope.organizationId, toDateKey(date)],
      exec(scope),
    );
  },

  async findApprovedLeave(scope: TenantScope, employeeId: string, date: Date) {
    return queryOne<{ id: string; type: LeaveType; days: number }>(
      `SELECT id, type, days FROM leaves
        WHERE organization_id = $1
          AND employee_id = $2
          AND status = 'APPROVED'
          AND $3 BETWEEN start_date AND end_date
        LIMIT 1`,
      [scope.organizationId, employeeId, toDateKey(date)],
      exec(scope),
    );
  },

  /** Active employees with no record for a date — absent so far today. */
  async findEmployeesWithoutRecord(
    scope: TenantScope,
    date: Date,
    employeeIds?: readonly string[],
  ) {
    const rows = await query<{
      id: string;
      first_name: string;
      last_name: string;
      avatar_url: string | null;
      designation: string;
    }>(
      `SELECT e.id, e.first_name, e.last_name, e.avatar_url, e.designation
         FROM employees e
        WHERE e.organization_id = $1
          AND e.deleted_at IS NULL
          AND e.status = 'ACTIVE'
          AND ($3::uuid[] IS NULL OR e.id = ANY($3::uuid[]))
          AND NOT EXISTS (
                SELECT 1 FROM attendance_records a
                 WHERE a.employee_id = e.id AND a.date = $2
              )
        ORDER BY e.first_name ASC`,
      [scope.organizationId, toDateKey(date), employeeIds ? [...employeeIds] : null],
      exec(scope),
    );

    return rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      avatarUrl: row.avatar_url,
      designation: row.designation,
    }));
  },
};
