import "server-only";

import type { z } from "zod";

import { execute, query, queryExactlyOne } from "@/server/db/query";
import { exec } from "@/server/db/tenant";
import type {
  attendancePolicySchema,
  organizationProfileSchema,
  workingHoursSchema,
} from "@/lib/validation/organization";
import type { AuthSession } from "@/server/auth/types";
import { organizationRepository } from "@/server/repositories/org-repository";
import { auditService, diff } from "@/server/services/audit-service";
import { tenantScopeFor } from "@/server/services/access-service";

/**
 * Organisation settings.
 *
 * Every change here alters how attendance is judged for everyone in the
 * tenant — moving the grace period retroactively changes who counts as late on
 * future days, and turning off geofence enforcement changes who can record
 * attendance at all. So each mutation is audited with a before/after diff.
 */

type ProfileInput = z.infer<typeof organizationProfileSchema>;
type HoursInput = z.infer<typeof workingHoursSchema>;
type PolicyInput = z.infer<typeof attendancePolicySchema>;

export const settingsService = {
  async updateProfile(session: AuthSession, input: ProfileInput) {
    const scope = tenantScopeFor(session);
    const before = await organizationRepository.requireById(scope.organizationId);

    const updated = await organizationRepository.update(scope.organizationId, {
      name: input.name,
      legalName: input.legalName ?? null,
      logoUrl: input.logoUrl ?? null,
      timezone: input.timezone,
      currency: input.currency.toUpperCase(),
      locale: input.locale,
    });

    await auditService.record(scope, session, {
      action: "UPDATE",
      entityType: "organizations",
      entityId: scope.organizationId,
      summary: `Updated organisation profile`,
      changes: diff(
        {
          name: before.name,
          timezone: before.timezone,
          currency: before.currency,
          locale: before.locale,
        },
        {
          name: updated.name,
          timezone: updated.timezone,
          currency: updated.currency,
          locale: updated.locale,
        },
      ),
    });

    return updated;
  },

  async updateWorkingHours(session: AuthSession, input: HoursInput) {
    const scope = tenantScopeFor(session);
    const before = await organizationRepository.requireById(scope.organizationId);

    const updated = await organizationRepository.update(scope.organizationId, {
      workdayStartMinutes: input.workdayStartMinutes,
      workdayEndMinutes: input.workdayEndMinutes,
      gracePeriodMinutes: input.gracePeriodMinutes,
      fullDayHours: input.fullDayHours,
      halfDayHours: input.halfDayHours,
      weekendDays: input.weekendDays,
    });

    await auditService.record(scope, session, {
      action: "UPDATE",
      entityType: "organizations",
      entityId: scope.organizationId,
      // Named specifically, because this is the setting people query later.
      summary: `Updated working hours and the ${input.gracePeriodMinutes}-minute grace period`,
      changes: diff(
        {
          workdayStartMinutes: before.workdayStartMinutes,
          workdayEndMinutes: before.workdayEndMinutes,
          gracePeriodMinutes: before.gracePeriodMinutes,
          fullDayHours: before.fullDayHours,
          halfDayHours: before.halfDayHours,
          weekendDays: before.weekendDays,
        },
        {
          workdayStartMinutes: updated.workdayStartMinutes,
          workdayEndMinutes: updated.workdayEndMinutes,
          gracePeriodMinutes: updated.gracePeriodMinutes,
          fullDayHours: updated.fullDayHours,
          halfDayHours: updated.halfDayHours,
          weekendDays: updated.weekendDays,
        },
      ),
    });

    return updated;
  },

  /**
   * Attendance/location policy. Turning `enforceGeofence` off is an
   * access-control change — it lets anyone record attendance from anywhere —
   * so it is called out explicitly in the audit summary rather than buried in
   * a field diff.
   */
  async updateAttendancePolicy(session: AuthSession, input: PolicyInput) {
    const scope = tenantScopeFor(session);
    const before = await organizationRepository.requireById(scope.organizationId);

    const updated = await organizationRepository.update(scope.organizationId, {
      maxAccuracyMeters: input.maxAccuracyMeters,
      maxTravelSpeedKmh: input.maxTravelSpeedKmh,
      enforceGeofence: input.enforceGeofence,
      allowManualOverride: input.allowManualOverride,
      requireCheckoutLocation: input.requireCheckoutLocation,
    });

    const enforcementChanged = before.enforceGeofence !== updated.enforceGeofence;

    await auditService.record(scope, session, {
      action: enforcementChanged ? "PERMISSION_CHANGE" : "UPDATE",
      entityType: "organizations",
      entityId: scope.organizationId,
      summary: enforcementChanged
        ? `Geofence enforcement turned ${updated.enforceGeofence ? "ON" : "OFF"} — check-ins outside a perimeter are now ${updated.enforceGeofence ? "refused" : "allowed but flagged"}`
        : "Updated attendance policy",
      changes: diff(
        {
          maxAccuracyMeters: before.maxAccuracyMeters,
          maxTravelSpeedKmh: before.maxTravelSpeedKmh,
          enforceGeofence: before.enforceGeofence,
          allowManualOverride: before.allowManualOverride,
          requireCheckoutLocation: before.requireCheckoutLocation,
        },
        {
          maxAccuracyMeters: updated.maxAccuracyMeters,
          maxTravelSpeedKmh: updated.maxTravelSpeedKmh,
          enforceGeofence: updated.enforceGeofence,
          allowManualOverride: updated.allowManualOverride,
          requireCheckoutLocation: updated.requireCheckoutLocation,
        },
      ),
    });

    return updated;
  },

  async addHoliday(session: AuthSession, input: { name: string; date: Date; isOptional: boolean }) {
    const scope = tenantScopeFor(session);

    // Normalised to midnight UTC so a holiday lands on the same calendar day
    // regardless of the server's timezone.
    const created = await queryExactlyOne<{ id: string; date: Date; name: string; is_optional: boolean }>(
      `INSERT INTO holidays (organization_id, name, date, is_optional)
       VALUES ($1, $2, $3::date, $4)
       RETURNING id, name, date, is_optional`,
      [
        scope.organizationId,
        input.name,
        new Date(
          Date.UTC(input.date.getUTCFullYear(), input.date.getUTCMonth(), input.date.getUTCDate()),
        ),
        input.isOptional,
      ],
      exec(scope),
    );

    await auditService.record(scope, session, {
      action: "CREATE",
      entityType: "holidays",
      entityId: created.id,
      summary: `Added holiday "${input.name}" on ${created.date.toISOString().slice(0, 10)}`,
    });

    return created;
  },

  async removeHoliday(session: AuthSession, holidayId: string) {
    const scope = tenantScopeFor(session);

    // organization_id in the WHERE is the tenant boundary: a holiday id from
    // another organisation deletes nothing rather than deleting theirs.
    const removed = await execute(
      `DELETE FROM holidays WHERE id = $1 AND organization_id = $2`,
      [holidayId, scope.organizationId],
      exec(scope),
    );
    if (removed === 0) return { id: holidayId, removed: false };

    await auditService.record(scope, session, {
      action: "DELETE",
      entityType: "holidays",
      entityId: holidayId,
      summary: "Removed a holiday",
    });

    return { id: holidayId, removed: true };
  },

  async listHolidays(session: AuthSession) {
    const year = new Date().getUTCFullYear();
    const rows = await query<{ id: string; name: string; date: Date; is_optional: boolean }>(
      `SELECT id, name, date, is_optional
         FROM holidays
        WHERE organization_id = $1 AND date BETWEEN $2::date AND $3::date
        ORDER BY date ASC`,
      [
        session.organization.id,
        new Date(Date.UTC(year, 0, 1)),
        new Date(Date.UTC(year + 1, 11, 31)),
      ],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      date: row.date,
      isOptional: row.is_optional,
    }));
  },
};
