import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  assertFound,
  client,
  liveTenantWhere,
  tenantWhere,
  type TenantScope,
} from "@/server/repositories/tenant";

/** Teams, departments, notifications, audit log and organisation settings. */

export const teamSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  color: true,
  createdAt: true,
  department: { select: { id: true, name: true, color: true } },
  manager: {
    select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: true },
  },
  members: {
    select: {
      roleLabel: true,
      joinedAt: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          designation: true,
          status: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  },
  _count: { select: { members: true, tasks: true } },
} satisfies Prisma.TeamSelect;

export type TeamRecord = Prisma.TeamGetPayload<{ select: typeof teamSelect }>;

export const teamRepository = {
  async list(scope: TenantScope): Promise<TeamRecord[]> {
    return client(scope).team.findMany({
      where: liveTenantWhere(scope),
      select: teamSelect,
      orderBy: { name: "asc" },
    });
  },

  async findById(scope: TenantScope, id: string): Promise<TeamRecord | null> {
    return client(scope).team.findFirst({
      where: { id, ...liveTenantWhere(scope) },
      select: teamSelect,
    });
  },

  async requireById(scope: TenantScope, id: string): Promise<TeamRecord> {
    return assertFound(await this.findById(scope, id), "team");
  },

  /** Teams an employee belongs to or manages. */
  async listForEmployee(scope: TenantScope, employeeId: string): Promise<TeamRecord[]> {
    return client(scope).team.findMany({
      where: {
        ...liveTenantWhere(scope),
        OR: [{ managerId: employeeId }, { members: { some: { employeeId } } }],
      },
      select: teamSelect,
      orderBy: { name: "asc" },
    });
  },

  async memberIds(scope: TenantScope, teamId: string): Promise<string[]> {
    const rows = await client(scope).teamMember.findMany({
      where: { teamId, team: { ...liveTenantWhere(scope) } },
      select: { employeeId: true },
    });
    return rows.map((row) => row.employeeId);
  },

  async create(scope: TenantScope, data: Omit<Prisma.TeamUncheckedCreateInput, "organizationId">) {
    return client(scope).team.create({
      data: { ...data, organizationId: scope.organizationId },
      select: teamSelect,
    });
  },

  async update(scope: TenantScope, id: string, data: Prisma.TeamUpdateManyMutationInput) {
    const result = await client(scope).team.updateMany({ where: { id, ...liveTenantWhere(scope) }, data });
    if (result.count === 0) return null;
    return this.findById(scope, id);
  },

  async replaceMembers(scope: TenantScope, teamId: string, employeeIds: readonly string[]) {
    const db = client(scope);
    await db.teamMember.deleteMany({ where: { teamId, team: { ...liveTenantWhere(scope) } } });
    if (employeeIds.length === 0) return;
    await db.teamMember.createMany({
      data: employeeIds.map((employeeId) => ({ teamId, employeeId })),
      skipDuplicates: true,
    });
  },

  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const result = await client(scope).team.updateMany({
      where: { id, ...liveTenantWhere(scope) },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  },
};

export const departmentRepository = {
  async list(scope: TenantScope) {
    return client(scope).department.findMany({
      where: liveTenantWhere(scope),
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        color: true,
        head: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { employees: true, teams: true } },
      },
      orderBy: { name: "asc" },
    });
  },

  async create(scope: TenantScope, data: Omit<Prisma.DepartmentUncheckedCreateInput, "organizationId">) {
    return client(scope).department.create({
      data: { ...data, organizationId: scope.organizationId },
    });
  },
};

// --- Notifications ----------------------------------------------------------

export const notificationRepository = {
  async listForUser(scope: TenantScope, userId: string, limit = 30) {
    return client(scope).notification.findMany({
      where: { ...tenantWhere(scope), userId, channel: "IN_APP" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  async countUnread(scope: TenantScope, userId: string): Promise<number> {
    return client(scope).notification.count({
      where: { ...tenantWhere(scope), userId, channel: "IN_APP", readAt: null },
    });
  },

  async createMany(scope: TenantScope, rows: Array<Omit<Prisma.NotificationUncheckedCreateInput, "organizationId">>) {
    if (rows.length === 0) return { count: 0 };
    return client(scope).notification.createMany({
      data: rows.map((row) => ({ ...row, organizationId: scope.organizationId })),
    });
  },

  async markRead(scope: TenantScope, userId: string, notificationId: string) {
    const result = await client(scope).notification.updateMany({
      // userId in the filter is what stops one user marking another's notification.
      where: { id: notificationId, userId, ...tenantWhere(scope) },
      data: { readAt: new Date() },
    });
    return result.count > 0;
  },

  async markAllRead(scope: TenantScope, userId: string) {
    const result = await client(scope).notification.updateMany({
      where: { ...tenantWhere(scope), userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  },
};

// --- Audit ------------------------------------------------------------------

export const auditRepository = {
  async record(scope: TenantScope, entry: Omit<Prisma.AuditLogUncheckedCreateInput, "organizationId">) {
    return client(scope).auditLog.create({
      data: { ...entry, organizationId: scope.organizationId },
    });
  },

  async list(scope: TenantScope, limit = 50, entityType?: string) {
    return client(scope).auditLog.findMany({
      where: { ...tenantWhere(scope), ...(entityType ? { entityType } : {}) },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        changes: true,
        createdAt: true,
        ipAddress: true,
        actor: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};

// --- Organisation -----------------------------------------------------------

export const organizationRepository = {
  async findById(organizationId: string) {
    return prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
    });
  },

  async requireById(organizationId: string) {
    return assertFound(await this.findById(organizationId), "organisation");
  },

  async update(organizationId: string, data: Prisma.OrganizationUpdateInput) {
    return prisma.organization.update({ where: { id: organizationId }, data });
  },

  /** The attendance policy fields, read on every check-in. */
  async policy(organizationId: string) {
    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        id: true,
        timezone: true,
        workdayStartMinutes: true,
        workdayEndMinutes: true,
        gracePeriodMinutes: true,
        fullDayHours: true,
        halfDayHours: true,
        weekendDays: true,
        maxAccuracyMeters: true,
        maxTravelSpeedKmh: true,
        enforceGeofence: true,
        allowManualOverride: true,
        requireCheckoutLocation: true,
      },
    });
    return assertFound(organization, "organisation");
  },
};
