import "server-only";

import type { Prisma } from "@prisma/client";

import {
  client,
  liveTenantWhere,
  paginate,
  skipTake,
  tenantWhere,
  type Paginated,
  type TenantScope,
} from "@/server/repositories/tenant";

export const attendanceRecordSelect = {
  id: true,
  date: true,
  checkInAt: true,
  checkOutAt: true,
  status: true,
  workedMinutes: true,
  breakMinutes: true,
  overtimeMinutes: true,
  lateByMinutes: true,
  earlyByMinutes: true,
  isManualEntry: true,
  overrideReason: true,
  notes: true,
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      employeeCode: true,
      designation: true,
      department: { select: { id: true, name: true, color: true } },
    },
  },
  office: { select: { id: true, name: true, city: true } },
} satisfies Prisma.AttendanceRecordSelect;

export type AttendanceRecordRow = Prisma.AttendanceRecordGetPayload<{
  select: typeof attendanceRecordSelect;
}>;

/**
 * Midnight UTC of a calendar day.
 *
 * Attendance days are stored as a `DATE`, anchored to midnight UTC, so that a
 * record's identity does not shift with the server's timezone. Which calendar
 * day a timestamp belongs to is decided in the attendance service using the
 * office's IANA timezone — this helper only normalises an already-decided day.
 */
export function toDateKey(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const attendanceRepository = {
  async findRecord(scope: TenantScope, employeeId: string, date: Date) {
    return client(scope).attendanceRecord.findFirst({
      where: { ...tenantWhere(scope), employeeId, date: toDateKey(date) },
      select: attendanceRecordSelect,
    });
  },

  /** Today's row for an employee, creating nothing — callers decide that. */
  async findRecordWithBreaks(scope: TenantScope, employeeId: string, date: Date) {
    return client(scope).attendanceRecord.findFirst({
      where: { ...tenantWhere(scope), employeeId, date: toDateKey(date) },
      select: {
        ...attendanceRecordSelect,
        breaks: {
          select: { id: true, startedAt: true, endedAt: true, minutes: true, reason: true },
          orderBy: { startedAt: "asc" },
        },
        events: {
          select: {
            id: true,
            type: true,
            occurredAt: true,
            verification: true,
            distanceMeters: true,
            accuracyMeters: true,
            riskFlags: true,
            office: { select: { id: true, name: true } },
          },
          orderBy: { occurredAt: "asc" },
        },
      },
    });
  },

  async upsertRecord(
    scope: TenantScope,
    employeeId: string,
    date: Date,
    create: Omit<Prisma.AttendanceRecordUncheckedCreateInput, "organizationId" | "employeeId" | "date">,
    update: Prisma.AttendanceRecordUncheckedUpdateInput,
  ) {
    const dateKey = toDateKey(date);
    return client(scope).attendanceRecord.upsert({
      // The composite unique makes this atomic; two concurrent check-ins
      // cannot create two rows for the same employee-day.
      where: { employeeId_date: { employeeId, date: dateKey } },
      create: { ...create, organizationId: scope.organizationId, employeeId, date: dateKey },
      update,
      select: attendanceRecordSelect,
    });
  },

  async list(
    scope: TenantScope,
    filters: {
      employeeIds?: readonly string[];
      officeId?: string;
      departmentId?: string;
      teamId?: string;
      status?: Prisma.EnumAttendanceStatusFilter | Prisma.AttendanceRecordWhereInput["status"];
      from?: Date;
      to?: Date;
    },
    page: number,
    pageSize: number,
  ): Promise<Paginated<AttendanceRecordRow>> {
    const db = client(scope);
    const where: Prisma.AttendanceRecordWhereInput = { ...tenantWhere(scope) };

    if (filters.employeeIds) where.employeeId = { in: [...filters.employeeIds] };
    if (filters.officeId) where.officeId = filters.officeId;
    if (filters.status) where.status = filters.status;

    // Department and team both filter through the related employee, so they
    // are collected into one nested clause rather than overwriting each other.
    const employeeFilter: Prisma.EmployeeWhereInput = {};
    if (filters.departmentId) employeeFilter.departmentId = filters.departmentId;
    if (filters.teamId) employeeFilter.teamMemberships = { some: { teamId: filters.teamId } };
    if (Object.keys(employeeFilter).length > 0) where.employee = employeeFilter;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from ? { gte: toDateKey(filters.from) } : {}),
        ...(filters.to ? { lte: toDateKey(filters.to) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      db.attendanceRecord.findMany({
        where,
        select: attendanceRecordSelect,
        orderBy: [{ date: "desc" }, { employee: { firstName: "asc" } }],
        ...skipTake(page, pageSize),
      }),
      db.attendanceRecord.count({ where }),
    ]);

    return paginate(items, total, page, pageSize);
  },

  /** Unpaginated range read, for calendars and charts. Bounded by date. */
  async listRange(
    scope: TenantScope,
    filters: { employeeIds?: readonly string[]; from: Date; to: Date },
  ) {
    return client(scope).attendanceRecord.findMany({
      where: {
        ...tenantWhere(scope),
        ...(filters.employeeIds ? { employeeId: { in: [...filters.employeeIds] } } : {}),
        date: { gte: toDateKey(filters.from), lte: toDateKey(filters.to) },
      },
      select: {
        id: true,
        date: true,
        employeeId: true,
        status: true,
        workedMinutes: true,
        overtimeMinutes: true,
        lateByMinutes: true,
        checkInAt: true,
        checkOutAt: true,
      },
      orderBy: { date: "asc" },
    });
  },

  async countByStatusForDate(scope: TenantScope, date: Date, employeeIds?: readonly string[]) {
    const rows = await client(scope).attendanceRecord.groupBy({
      by: ["status"],
      where: {
        ...tenantWhere(scope),
        date: toDateKey(date),
        ...(employeeIds ? { employeeId: { in: [...employeeIds] } } : {}),
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  },

  // --- Events (append-only) -------------------------------------------------

  async createEvent(scope: TenantScope, data: Omit<Prisma.AttendanceEventUncheckedCreateInput, "organizationId">) {
    return client(scope).attendanceEvent.create({
      data: { ...data, organizationId: scope.organizationId },
    });
  },

  /**
   * Most recent accepted fix for an employee, used by the impossible-travel
   * check. Only VERIFIED events count — a rejected fix must not become the
   * baseline for the next comparison.
   */
  async findLastAcceptedFix(scope: TenantScope, employeeId: string) {
    const event = await client(scope).attendanceEvent.findFirst({
      where: {
        ...tenantWhere(scope),
        employeeId,
        verification: "VERIFIED",
        latitude: { not: null },
        longitude: { not: null },
      },
      select: { latitude: true, longitude: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
    });

    if (!event || event.latitude === null || event.longitude === null) return null;
    return { latitude: event.latitude, longitude: event.longitude, at: event.occurredAt };
  },

  /** Rate limiting: how many events this employee raised in the window. */
  async countRecentEvents(scope: TenantScope, employeeId: string, sinceSeconds: number) {
    return client(scope).attendanceEvent.count({
      where: {
        ...tenantWhere(scope),
        employeeId,
        occurredAt: { gte: new Date(Date.now() - sinceSeconds * 1000) },
      },
    });
  },

  /** Flagged events for the compliance view. */
  async listFlaggedEvents(scope: TenantScope, limit = 25) {
    return client(scope).attendanceEvent.findMany({
      where: {
        ...tenantWhere(scope),
        OR: [
          { verification: { in: ["SUSPECTED_SPOOF", "OUTSIDE_GEOFENCE"] } },
          { riskFlags: { isEmpty: false } },
        ],
      },
      select: {
        id: true,
        type: true,
        occurredAt: true,
        verification: true,
        distanceMeters: true,
        accuracyMeters: true,
        riskFlags: true,
        source: true,
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        office: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: limit,
    });
  },

  // --- Breaks ---------------------------------------------------------------

  async findOpenBreak(scope: TenantScope, attendanceRecordId: string) {
    return client(scope).breakRecord.findFirst({
      where: { ...tenantWhere(scope), attendanceRecordId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
  },

  async startBreak(
    scope: TenantScope,
    data: Omit<Prisma.BreakRecordUncheckedCreateInput, "organizationId">,
  ) {
    return client(scope).breakRecord.create({
      data: { ...data, organizationId: scope.organizationId },
    });
  },

  async endBreak(scope: TenantScope, breakId: string, endedAt: Date, minutes: number) {
    const result = await client(scope).breakRecord.updateMany({
      where: { id: breakId, ...tenantWhere(scope) },
      data: { endedAt, minutes },
    });
    return result.count > 0;
  },

  async totalBreakMinutes(scope: TenantScope, attendanceRecordId: string): Promise<number> {
    const result = await client(scope).breakRecord.aggregate({
      where: { ...tenantWhere(scope), attendanceRecordId },
      _sum: { minutes: true },
    });
    return result._sum.minutes ?? 0;
  },

  // --- Holidays & leave -----------------------------------------------------

  async findHoliday(scope: TenantScope, date: Date) {
    return client(scope).holiday.findFirst({
      where: { ...tenantWhere(scope), date: toDateKey(date) },
      select: { id: true, name: true, isOptional: true },
    });
  },

  async listHolidays(scope: TenantScope, from: Date, to: Date) {
    return client(scope).holiday.findMany({
      where: { ...tenantWhere(scope), date: { gte: toDateKey(from), lte: toDateKey(to) } },
      orderBy: { date: "asc" },
    });
  },

  async findApprovedLeave(scope: TenantScope, employeeId: string, date: Date) {
    const dateKey = toDateKey(date);
    return client(scope).leave.findFirst({
      where: {
        ...tenantWhere(scope),
        employeeId,
        status: "APPROVED",
        startDate: { lte: dateKey },
        endDate: { gte: dateKey },
      },
      select: { id: true, type: true, days: true },
    });
  },

  async listLeaves(
    scope: TenantScope,
    filters: { employeeIds?: readonly string[]; status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" },
    limit = 50,
  ) {
    return client(scope).leave.findMany({
      where: {
        ...tenantWhere(scope),
        ...(filters.employeeIds ? { employeeId: { in: [...filters.employeeIds] } } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      select: {
        id: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        days: true,
        reason: true,
        reviewedAt: true,
        reviewNote: true,
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startDate: "desc" },
      take: limit,
    });
  },
};

/** Employees who have no attendance row for a date — i.e. absent so far. */
export async function findEmployeesWithoutRecord(
  scope: TenantScope,
  date: Date,
  employeeIds?: readonly string[],
) {
  return client(scope).employee.findMany({
    where: {
      ...liveTenantWhere(scope),
      status: "ACTIVE",
      ...(employeeIds ? { id: { in: [...employeeIds] } } : {}),
      attendanceRecords: { none: { date: toDateKey(date) } },
    },
    select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: true },
  });
}
