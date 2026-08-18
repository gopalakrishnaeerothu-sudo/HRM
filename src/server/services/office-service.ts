import "server-only";

import { prisma } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { CreateOfficeInput, UpdateOfficeInput, UpsertGeofenceInput } from "@/lib/validation/office";
import type { AuthSession } from "@/server/auth/types";
import { officeRepository } from "@/server/repositories/office-repository";
import { auditService, describeGeofenceChange, diff } from "@/server/services/audit-service";
import { tenantScopeFor } from "@/server/services/access-service";

/**
 * Office and geofence management.
 *
 * Geofence changes get their own audit action (`GEOFENCE_CHANGE`) because they
 * directly alter who can record attendance — widening a radius from 100 m to
 * 1 km is an access-control change, not a cosmetic edit, and it should be as
 * easy to review as a permission change.
 */
export const officeService = {
  async list(session: AuthSession) {
    return officeRepository.list(tenantScopeFor(session));
  },

  async detail(session: AuthSession, officeId: string) {
    return officeRepository.requireById(tenantScopeFor(session), officeId);
  },

  async create(session: AuthSession, input: CreateOfficeInput) {
    const scope = tenantScopeFor(session);

    if (await officeRepository.isCodeTaken(scope, input.code)) {
      throw errors.validation("That office code is already in use.", { code: ["Already used"] });
    }

    const office = await prisma.$transaction(async (tx) => {
      const created = await tx.office.create({
        data: {
          organizationId: scope.organizationId,
          name: input.name,
          code: input.code,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state ?? null,
          country: input.country,
          postalCode: input.postalCode ?? null,
          timezone: input.timezone,
          latitude: input.latitude,
          longitude: input.longitude,
          workdayStartMinutes: input.workdayStartMinutes,
          workdayEndMinutes: input.workdayEndMinutes,
          gracePeriodMinutes: input.gracePeriodMinutes,
          status: input.status,
        },
        select: { id: true, name: true },
      });

      // Every office gets a primary perimeter at creation, so an employee can
      // never be assigned to an office with no geofence to check into.
      await tx.officeGeofence.create({
        data: {
          officeId: created.id,
          name: "Main perimeter",
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
          isPrimary: true,
          isActive: true,
        },
      });

      return created;
    });

    await auditService.record(scope, session, {
      action: "CREATE",
      entityType: "offices",
      entityId: office.id,
      summary: `Created office ${input.name} (${input.code}) with a ${input.radiusMeters} m perimeter`,
      changes: {
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
      },
    });

    return officeRepository.requireById(scope, office.id);
  },

  async update(session: AuthSession, officeId: string, input: UpdateOfficeInput) {
    const scope = tenantScopeFor(session);
    const before = await officeRepository.requireById(scope, officeId);

    const updated = await officeRepository.update(scope, officeId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state ?? null } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode ?? null } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.workdayStartMinutes !== undefined ? { workdayStartMinutes: input.workdayStartMinutes } : {}),
      ...(input.workdayEndMinutes !== undefined ? { workdayEndMinutes: input.workdayEndMinutes } : {}),
      ...(input.gracePeriodMinutes !== undefined ? { gracePeriodMinutes: input.gracePeriodMinutes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (!updated) throw errors.notFound("office");

    await auditService.record(scope, session, {
      action: "UPDATE",
      entityType: "offices",
      entityId: officeId,
      summary: `Updated office ${updated.name}`,
      changes: diff(
        {
          name: before.name,
          timezone: before.timezone,
          status: before.status,
          workdayStartMinutes: before.workdayStartMinutes,
          workdayEndMinutes: before.workdayEndMinutes,
        },
        {
          name: updated.name,
          timezone: updated.timezone,
          status: updated.status,
          workdayStartMinutes: updated.workdayStartMinutes,
          workdayEndMinutes: updated.workdayEndMinutes,
        },
      ),
    });

    return updated;
  },

  /** Create or replace a geofence zone, auditing the effective change. */
  async upsertGeofence(session: AuthSession, officeId: string, input: UpsertGeofenceInput) {
    const scope = tenantScopeFor(session);
    const office = await officeRepository.requireById(scope, officeId);

    if (input.id) {
      const before = await officeRepository.findGeofence(scope, input.id);
      if (!before || before.officeId !== officeId) throw errors.notFound("geofence");

      const ok = await officeRepository.updateGeofence(scope, input.id, {
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        isPrimary: input.isPrimary,
        isActive: input.isActive,
      });
      if (!ok) throw errors.notFound("geofence");

      if (input.isPrimary) await officeRepository.clearPrimaryFlag(scope, officeId, input.id);

      await auditService.record(scope, session, {
        action: "GEOFENCE_CHANGE",
        entityType: "office_geofences",
        entityId: input.id,
        summary: describeGeofenceChange(office.name, before, input),
        changes: diff(
          { radiusMeters: before.radiusMeters, latitude: before.latitude, longitude: before.longitude },
          { radiusMeters: input.radiusMeters, latitude: input.latitude, longitude: input.longitude },
        ),
      });

      return officeRepository.requireById(scope, officeId);
    }

    const createdGeofenceId = await officeRepository.createGeofence(scope, officeId, {
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      isPrimary: input.isPrimary,
      isActive: input.isActive,
    });

    if (input.isPrimary) await officeRepository.clearPrimaryFlag(scope, officeId, createdGeofenceId);

    await auditService.record(scope, session, {
      action: "GEOFENCE_CHANGE",
      entityType: "office_geofences",
      entityId: createdGeofenceId,
      summary: `Added a ${input.radiusMeters} m zone “${input.name}” to ${office.name}`,
      changes: { radiusMeters: input.radiusMeters, latitude: input.latitude, longitude: input.longitude },
    });

    return officeRepository.requireById(scope, officeId);
  },

  async removeGeofence(session: AuthSession, officeId: string, geofenceId: string) {
    const scope = tenantScopeFor(session);
    const office = await officeRepository.requireById(scope, officeId);

    const activeZones = office.geofences.filter((zone) => zone.isActive);
    if (activeZones.length <= 1) {
      throw errors.precondition(
        "An office needs at least one active zone — otherwise nobody could check in there.",
      );
    }

    const removed = await officeRepository.deleteGeofence(scope, geofenceId);
    if (!removed) throw errors.notFound("geofence");

    await auditService.record(scope, session, {
      action: "GEOFENCE_CHANGE",
      entityType: "office_geofences",
      entityId: geofenceId,
      summary: `Removed a geofence zone from ${office.name}`,
    });

    return { id: geofenceId };
  },

  async deactivate(session: AuthSession, officeId: string) {
    const scope = tenantScopeFor(session);
    const office = await officeRepository.requireById(scope, officeId);

    const assigned = await officeRepository.countAssignedEmployees(scope, officeId);
    if (assigned > 0) {
      throw errors.precondition(
        `${assigned} ${assigned === 1 ? "employee is" : "employees are"} assigned to ${office.name}. Move them to another office first.`,
      );
    }

    await officeRepository.softDelete(scope, officeId);

    await auditService.record(scope, session, {
      action: "DELETE",
      entityType: "offices",
      entityId: officeId,
      summary: `Deactivated office ${office.name}`,
    });

    return { id: officeId };
  },
};
