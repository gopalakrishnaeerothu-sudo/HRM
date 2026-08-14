import "server-only";

import type { Prisma } from "@prisma/client";

import type { GeofenceZone } from "@/server/geo/verify";
import {
  assertFound,
  client,
  liveTenantWhere,
  type TenantScope,
} from "@/server/repositories/tenant";

export const officeSelect = {
  id: true,
  name: true,
  code: true,
  addressLine: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  timezone: true,
  latitude: true,
  longitude: true,
  workdayStartMinutes: true,
  workdayEndMinutes: true,
  gracePeriodMinutes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  geofences: {
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      isPrimary: true,
      isActive: true,
    },
    orderBy: { isPrimary: "desc" },
  },
  _count: { select: { primaryEmployees: true } },
} satisfies Prisma.OfficeSelect;

export type OfficeRecord = Prisma.OfficeGetPayload<{ select: typeof officeSelect }>;

export const officeRepository = {
  async list(scope: TenantScope, includeInactive = true): Promise<OfficeRecord[]> {
    return client(scope).office.findMany({
      where: { ...liveTenantWhere(scope), ...(includeInactive ? {} : { status: "ACTIVE" }) },
      select: officeSelect,
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
  },

  async findById(scope: TenantScope, id: string): Promise<OfficeRecord | null> {
    return client(scope).office.findFirst({
      where: { id, ...liveTenantWhere(scope) },
      select: officeSelect,
    });
  },

  async requireById(scope: TenantScope, id: string): Promise<OfficeRecord> {
    return assertFound(await this.findById(scope, id), "office");
  },

  /**
   * Active geofence zones an employee may check in from: their primary office
   * plus any additionally assigned offices.
   *
   * This is the *authorisation envelope* for a check-in — the client never
   * names the office it wants to check into, the server derives the candidate
   * set from the employee record.
   */
  async listZonesForEmployee(scope: TenantScope, employeeId: string): Promise<GeofenceZone[]> {
    const employee = await client(scope).employee.findFirst({
      where: { id: employeeId, ...liveTenantWhere(scope) },
      select: {
        primaryOfficeId: true,
        officeAccess: { select: { officeId: true } },
      },
    });

    if (!employee) return [];

    const officeIds = new Set<string>();
    if (employee.primaryOfficeId) officeIds.add(employee.primaryOfficeId);
    employee.officeAccess.forEach((access) => officeIds.add(access.officeId));
    if (officeIds.size === 0) return [];

    const offices = await client(scope).office.findMany({
      where: {
        id: { in: Array.from(officeIds) },
        ...liveTenantWhere(scope),
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        geofences: {
          where: { isActive: true },
          select: { id: true, latitude: true, longitude: true, radiusMeters: true },
        },
      },
    });

    return offices.flatMap((office) =>
      office.geofences.map((geofence) => ({
        id: geofence.id,
        officeId: office.id,
        officeName: office.name,
        latitude: geofence.latitude,
        longitude: geofence.longitude,
        radiusMeters: geofence.radiusMeters,
      })),
    );
  },

  async create(scope: TenantScope, data: Omit<Prisma.OfficeUncheckedCreateInput, "organizationId">) {
    return client(scope).office.create({
      data: { ...data, organizationId: scope.organizationId },
      select: officeSelect,
    });
  },

  async update(scope: TenantScope, id: string, data: Prisma.OfficeUpdateManyMutationInput) {
    const result = await client(scope).office.updateMany({
      where: { id, ...liveTenantWhere(scope) },
      data,
    });
    if (result.count === 0) return null;
    return this.findById(scope, id);
  },

  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const result = await client(scope).office.updateMany({
      where: { id, ...liveTenantWhere(scope) },
      data: { deletedAt: new Date(), status: "INACTIVE" },
    });
    return result.count > 0;
  },

  /** Employees whose primary office is this one. Blocks deletion when non-zero. */
  async countAssignedEmployees(scope: TenantScope, officeId: string): Promise<number> {
    return client(scope).employee.count({
      where: { ...liveTenantWhere(scope), primaryOfficeId: officeId },
    });
  },

  async isCodeTaken(scope: TenantScope, code: string, exceptId?: string): Promise<boolean> {
    const found = await client(scope).office.findFirst({
      where: {
        organizationId: scope.organizationId,
        code,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  },

  // --- Geofences ------------------------------------------------------------

  async findGeofence(scope: TenantScope, geofenceId: string) {
    return client(scope).officeGeofence.findFirst({
      // The join through `office` is what tenant-scopes a geofence, since the
      // table has no organizationId of its own.
      where: { id: geofenceId, office: { ...liveTenantWhere(scope) } },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        radiusMeters: true,
        isPrimary: true,
        isActive: true,
        officeId: true,
        office: { select: { id: true, name: true } },
      },
    });
  },

  async createGeofence(scope: TenantScope, officeId: string, data: Omit<Prisma.OfficeGeofenceUncheckedCreateInput, "officeId">) {
    await this.requireById(scope, officeId);
    return client(scope).officeGeofence.create({
      data: { ...data, officeId },
    });
  },

  async updateGeofence(
    scope: TenantScope,
    geofenceId: string,
    data: Prisma.OfficeGeofenceUpdateManyMutationInput,
  ) {
    const result = await client(scope).officeGeofence.updateMany({
      where: { id: geofenceId, office: { ...liveTenantWhere(scope) } },
      data,
    });
    return result.count > 0;
  },

  /** Demote every other zone so exactly one primary exists per office. */
  async clearPrimaryFlag(scope: TenantScope, officeId: string, exceptId?: string) {
    await client(scope).officeGeofence.updateMany({
      where: {
        officeId,
        office: { ...liveTenantWhere(scope) },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      data: { isPrimary: false },
    });
  },

  async deleteGeofence(scope: TenantScope, geofenceId: string): Promise<boolean> {
    const result = await client(scope).officeGeofence.updateMany({
      where: { id: geofenceId, office: { ...liveTenantWhere(scope) } },
      data: { isActive: false },
    });
    return result.count > 0;
  },
};
