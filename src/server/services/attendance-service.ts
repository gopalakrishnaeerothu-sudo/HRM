import "server-only";

import type { AttendanceSource } from "@/server/db/types";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { errors } from "@/lib/errors";
import { zonedDateKey, zonedMinutesOfDay, zonedParts } from "@/lib/time";
import type { LocationClaim } from "@/lib/validation/common";
import type { OverrideAttendanceInput } from "@/lib/validation/attendance";
import type { AuthSession } from "@/server/auth/types";
import { verifyLocation, type VerificationResult } from "@/server/geo/verify";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { officeRepository } from "@/server/repositories/office-repository";
import { organizationRepository } from "@/server/repositories/org-repository";
import type { TenantScope } from "@/server/repositories/tenant";
import { auditService } from "@/server/services/audit-service";
import { computeDay, liveWorkedMinutes, type WorkdayPolicy } from "@/server/services/attendance-rules";
import { consume, RATE_LIMITS, rateLimitKey } from "@/server/services/rate-limit";
import { tenantScopeFor } from "@/server/services/access-service";

/**
 * Attendance orchestration.
 *
 * The invariant this file exists to enforce:
 *
 *   The client supplies coordinates. The server decides everything else —
 *   which office applies, how far away the person is, whether that is inside
 *   the perimeter, which calendar day the event belongs to, and whether the
 *   arrival was late.
 *
 * Nothing here reads an office id, a distance or an "inside" flag from the
 * request; `checkInSchema` has no field for them.
 */

export interface AttendanceActionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  source?: AttendanceSource;
}

export interface CheckInOutcome {
  ok: boolean;
  verification: VerificationResult;
  record: Awaited<ReturnType<typeof attendanceRepository.findRecord>> | null;
  message: string;
}

/** Organisation policy plus the applicable office's working window. */
async function loadPolicy(scope: TenantScope, officeId: string | null) {
  const organization = await organizationRepository.policy(scope.organizationId);

  let timezone = organization.timezone;
  let workday: WorkdayPolicy = {
    startMinutes: organization.workdayStartMinutes,
    endMinutes: organization.workdayEndMinutes,
    gracePeriodMinutes: organization.gracePeriodMinutes,
    fullDayHours: organization.fullDayHours,
    halfDayHours: organization.halfDayHours,
  };

  if (officeId) {
    const office = await officeRepository.findById(scope, officeId);
    if (office) {
      // The office's local clock is what "09:00" means for its staff.
      timezone = office.timezone;
      workday = {
        startMinutes: office.workdayStartMinutes,
        endMinutes: office.workdayEndMinutes,
        gracePeriodMinutes: office.gracePeriodMinutes,
        fullDayHours: organization.fullDayHours,
        halfDayHours: organization.halfDayHours,
      };
    }
  }

  return { organization, timezone, workday };
}

/** Apply the employee's personal shift override, when they have one. */
function applyShiftOverride(
  workday: WorkdayPolicy,
  shiftStartMinutes: number | null | undefined,
  shiftEndMinutes: number | null | undefined,
): WorkdayPolicy {
  if (shiftStartMinutes == null || shiftEndMinutes == null) return workday;
  return { ...workday, startMinutes: shiftStartMinutes, endMinutes: shiftEndMinutes };
}

export const attendanceService = {
  /**
   * Today's state for the signed-in employee: whether they are checked in,
   * live worked minutes, and which offices they may check into.
   */
  async todayFor(session: AuthSession) {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const scope = tenantScopeFor(session);
    const { timezone, workday, organization } = await loadPolicy(scope, employee.primaryOfficeId);
    const now = new Date();
    const dateKey = zonedDateKey(now, timezone);

    const [record, zones] = await Promise.all([
      attendanceRepository.findRecordWithBreaks(scope, employee.id, dateKey),
      officeRepository.listZonesForEmployee(scope, employee.id),
    ]);

    const openBreak = record?.breaks.find((entry) => entry.endedAt === null) ?? null;

    const workedMinutes =
      record?.checkInAt && !record.checkOutAt
        ? liveWorkedMinutes(record.checkInAt, now, record.breakMinutes, openBreak?.startedAt ?? null)
        : (record?.workedMinutes ?? 0);

    return {
      date: dateKey,
      timezone,
      record,
      openBreak,
      workedMinutes,
      isCheckedIn: Boolean(record?.checkInAt && !record.checkOutAt),
      isCheckedOut: Boolean(record?.checkOutAt),
      zones,
      policy: {
        ...applyShiftOverride(workday, employee.primaryOfficeId ? undefined : null, null),
        enforceGeofence: organization.enforceGeofence,
        maxAccuracyMeters: organization.maxAccuracyMeters,
        requireCheckoutLocation: organization.requireCheckoutLocation,
      },
    };
  },

  /**
   * Verify a location claim without recording anything.
   * Powers the "you're inside the office" indicator, so the UI can show the
   * true server verdict rather than computing its own.
   */
  async previewLocation(session: AuthSession, claim: LocationClaim): Promise<VerificationResult> {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const scope = tenantScopeFor(session);
    const [organization, zones, previousFix] = await Promise.all([
      organizationRepository.policy(scope.organizationId),
      officeRepository.listZonesForEmployee(scope, employee.id),
      attendanceRepository.findLastAcceptedFix(scope, employee.id),
    ]);

    return verifyLocation({
      reported: {
        latitude: claim.latitude,
        longitude: claim.longitude,
        accuracyMeters: claim.accuracyMeters,
      },
      capturedAt: claim.capturedAt ? new Date(claim.capturedAt) : null,
      now: new Date(),
      zones,
      previousFix,
      policy: {
        maxAccuracyMeters: organization.maxAccuracyMeters,
        maxTravelSpeedKmh: organization.maxTravelSpeedKmh,
        maxFixAgeSeconds: 120,
        enforceGeofence: organization.enforceGeofence,
      },
    });
  },

  /**
   * Record a check-in.
   *
   * Every attempt — accepted or rejected — is written to `attendance_events`
   * with the coordinates, distance, accuracy and risk flags the decision used.
   * A rejected attempt leaves the same trail as an accepted one, which is what
   * makes repeated boundary probing visible after the fact.
   */
  async checkIn(
    session: AuthSession,
    claim: LocationClaim,
    context: AttendanceActionContext = {},
  ): Promise<CheckInOutcome> {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const scope = tenantScopeFor(session);

    const limit = consume(
      rateLimitKey("attendance", session.organization.id, employee.id),
      RATE_LIMITS.attendanceAction.limit,
      RATE_LIMITS.attendanceAction.windowSeconds,
    );
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds);

    const [organization, zones, previousFix] = await Promise.all([
      organizationRepository.policy(scope.organizationId),
      officeRepository.listZonesForEmployee(scope, employee.id),
      attendanceRepository.findLastAcceptedFix(scope, employee.id),
    ]);

    const now = new Date();
    const verification = verifyLocation({
      reported: {
        latitude: claim.latitude,
        longitude: claim.longitude,
        accuracyMeters: claim.accuracyMeters,
      },
      capturedAt: claim.capturedAt ? new Date(claim.capturedAt) : null,
      now,
      zones,
      previousFix,
      policy: {
        maxAccuracyMeters: organization.maxAccuracyMeters,
        maxTravelSpeedKmh: organization.maxTravelSpeedKmh,
        maxFixAgeSeconds: 120,
        enforceGeofence: organization.enforceGeofence,
      },
    });

    const officeId = verification.nearestZone?.officeId ?? employee.primaryOfficeId ?? null;
    const { timezone, workday } = await loadPolicy(scope, officeId);
    const dateKey = zonedDateKey(now, timezone);

    // Rejected: log the attempt, change no attendance state.
    if (!verification.allowed) {
      await attendanceRepository.createEvent(scope, {
        employeeId: employee.id,
        officeId,
        geofenceId: verification.nearestZone?.id ?? null,
        type: "CHECK_IN",
        occurredAt: now,
        latitude: claim.latitude,
        longitude: claim.longitude,
        accuracyMeters: claim.accuracyMeters ?? null,
        distanceMeters: verification.distanceMeters,
        verification: verification.verification,
        source: context.source ?? "WEB",
        riskFlags: verification.riskFlags,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        deviceId: claim.deviceId ?? null,
      });

      return { ok: false, verification, record: null, message: verification.message };
    }

    const existing = await attendanceRepository.findRecord(scope, employee.id, dateKey);
    if (existing?.checkInAt && !existing.checkOutAt) {
      throw errors.conflict("You're already checked in for today.");
    }
    if (existing?.checkOutAt) {
      throw errors.conflict("You've already completed today's attendance.");
    }

    const checkInMinutes = zonedMinutesOfDay(now, timezone);
    const [holiday, leave] = await Promise.all([
      attendanceRepository.findHoliday(scope, dateKey),
      attendanceRepository.findApprovedLeave(scope, employee.id, dateKey),
    ]);

    const computed = computeDay({
      policy: workday,
      checkInMinutes,
      checkOutMinutes: null,
      breakMinutes: 0,
      isWeekend: organization.weekendDays.includes(zonedParts(now, timezone).weekday),
      isHoliday: Boolean(holiday),
      isOnApprovedLeave: Boolean(leave),
    });

    // One transaction so the record and its event cannot diverge.
    const record = await prisma.$transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, db: tx };

      const saved = await attendanceRepository.upsertRecord(
        txScope,
        employee.id,
        dateKey,
        {
          officeId,
          checkInAt: now,
          status: computed.status,
          lateByMinutes: computed.lateByMinutes,
          workedMinutes: 0,
        },
        {
          officeId,
          checkInAt: now,
          status: computed.status,
          lateByMinutes: computed.lateByMinutes,
        },
      );

      await attendanceRepository.createEvent(txScope, {
        employeeId: employee.id,
        attendanceRecordId: saved.id,
        officeId,
        geofenceId: verification.nearestZone?.id ?? null,
        type: "CHECK_IN",
        occurredAt: now,
        latitude: claim.latitude,
        longitude: claim.longitude,
        accuracyMeters: claim.accuracyMeters ?? null,
        distanceMeters: verification.distanceMeters,
        verification: verification.verification,
        source: context.source ?? "WEB",
        riskFlags: verification.riskFlags,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        deviceId: claim.deviceId ?? null,
      });

      return saved;
    });

    return {
      ok: true,
      verification,
      record,
      message:
        computed.lateByMinutes > 0
          ? `Checked in at ${verification.nearestZone?.officeName ?? "your office"} — ${computed.lateByMinutes} min after the grace period.`
          : `Checked in at ${verification.nearestZone?.officeName ?? "your office"}.`,
    };
  },

  /** Record a check-out and finalise the day's totals. */
  async checkOut(
    session: AuthSession,
    claim: LocationClaim | undefined,
    notes: string | undefined,
    context: AttendanceActionContext = {},
  ): Promise<CheckInOutcome> {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const scope = tenantScopeFor(session);

    const limit = consume(
      rateLimitKey("attendance", session.organization.id, employee.id),
      RATE_LIMITS.attendanceAction.limit,
      RATE_LIMITS.attendanceAction.windowSeconds,
    );
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds);

    const organization = await organizationRepository.policy(scope.organizationId);
    const { timezone, workday } = await loadPolicy(scope, employee.primaryOfficeId);
    const now = new Date();
    const dateKey = zonedDateKey(now, timezone);

    const record = await attendanceRepository.findRecordWithBreaks(scope, employee.id, dateKey);
    if (!record?.checkInAt) throw errors.precondition("You haven't checked in today.");
    if (record.checkOutAt) throw errors.conflict("You've already checked out today.");

    // Optional policy: some organisations require a verified location to leave.
    let verification: VerificationResult | null = null;
    if (organization.requireCheckoutLocation) {
      if (!claim) {
        throw errors.precondition("This organisation requires location verification to check out.");
      }
      verification = await this.previewLocation(session, claim);
      if (!verification.allowed) {
        await attendanceRepository.createEvent(scope, {
          employeeId: employee.id,
          attendanceRecordId: record.id,
          officeId: record.office?.id ?? null,
          type: "CHECK_OUT",
          occurredAt: now,
          latitude: claim.latitude,
          longitude: claim.longitude,
          accuracyMeters: claim.accuracyMeters ?? null,
          distanceMeters: verification.distanceMeters,
          verification: verification.verification,
          source: context.source ?? "WEB",
          riskFlags: verification.riskFlags,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          deviceId: claim.deviceId ?? null,
        });
        return { ok: false, verification, record: null, message: verification.message };
      }
    }

    // An open break is closed automatically rather than silently inflating the
    // day's worked minutes.
    const openBreak = record.breaks.find((entry) => entry.endedAt === null);
    if (openBreak) {
      const minutes = Math.max(0, Math.round((now.getTime() - openBreak.startedAt.getTime()) / 60_000));
      await attendanceRepository.endBreak(scope, openBreak.id, now, minutes);
    }

    const breakMinutes = await attendanceRepository.totalBreakMinutes(scope, record.id);

    const [holiday, leave] = await Promise.all([
      attendanceRepository.findHoliday(scope, dateKey),
      attendanceRepository.findApprovedLeave(scope, employee.id, dateKey),
    ]);

    const computed = computeDay({
      policy: workday,
      checkInMinutes: zonedMinutesOfDay(record.checkInAt, timezone),
      checkOutMinutes: zonedMinutesOfDay(now, timezone),
      breakMinutes,
      isWeekend: organization.weekendDays.includes(zonedParts(now, timezone).weekday),
      isHoliday: Boolean(holiday),
      isOnApprovedLeave: Boolean(leave),
    });

    const saved = await prisma.$transaction(async (tx) => {
      const txScope: TenantScope = { organizationId: scope.organizationId, db: tx };

      const updated = await attendanceRepository.upsertRecord(
        txScope,
        employee.id,
        dateKey,
        {
          checkInAt: record.checkInAt,
          checkOutAt: now,
          status: computed.status,
          workedMinutes: computed.workedMinutes,
          breakMinutes,
          overtimeMinutes: computed.overtimeMinutes,
          lateByMinutes: computed.lateByMinutes,
          earlyByMinutes: computed.earlyByMinutes,
          notes: notes ?? null,
        },
        {
          checkOutAt: now,
          status: computed.status,
          workedMinutes: computed.workedMinutes,
          breakMinutes,
          overtimeMinutes: computed.overtimeMinutes,
          earlyByMinutes: computed.earlyByMinutes,
          ...(notes ? { notes } : {}),
        },
      );

      await attendanceRepository.createEvent(txScope, {
        employeeId: employee.id,
        attendanceRecordId: updated.id,
        officeId: record.office?.id ?? null,
        type: "CHECK_OUT",
        occurredAt: now,
        latitude: claim?.latitude ?? null,
        longitude: claim?.longitude ?? null,
        accuracyMeters: claim?.accuracyMeters ?? null,
        distanceMeters: verification?.distanceMeters ?? null,
        verification: verification?.verification ?? "NO_LOCATION",
        source: context.source ?? "WEB",
        riskFlags: verification?.riskFlags ?? [],
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        deviceId: claim?.deviceId ?? null,
      });

      return updated;
    });

    return {
      ok: true,
      verification: verification ?? {
        allowed: true,
        verification: "NO_LOCATION",
        nearestZone: null,
        distanceMeters: null,
        requiredRadiusMeters: null,
        riskFlags: [],
        message: "Checked out.",
      },
      record: saved,
      message: `Checked out — ${Math.floor(computed.workedMinutes / 60)}h ${String(computed.workedMinutes % 60).padStart(2, "0")}m recorded.`,
    };
  },

  /** Start or end a break. Breaks are subtracted from worked minutes. */
  async toggleBreak(session: AuthSession, action: "start" | "end", reason?: string) {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const scope = tenantScopeFor(session);
    const { timezone } = await loadPolicy(scope, employee.primaryOfficeId);
    const now = new Date();
    const dateKey = zonedDateKey(now, timezone);

    const record = await attendanceRepository.findRecord(scope, employee.id, dateKey);
    if (!record?.checkInAt) throw errors.precondition("Check in before starting a break.");
    if (record.checkOutAt) throw errors.precondition("Today's attendance is already closed.");

    const openBreak = await attendanceRepository.findOpenBreak(scope, record.id);

    if (action === "start") {
      if (openBreak) throw errors.conflict("You're already on a break.");
      await attendanceRepository.startBreak(scope, {
        employeeId: employee.id,
        attendanceRecordId: record.id,
        startedAt: now,
        reason: reason ?? null,
      });
      await attendanceRepository.createEvent(scope, {
        employeeId: employee.id,
        attendanceRecordId: record.id,
        type: "BREAK_START",
        occurredAt: now,
        verification: "NO_LOCATION",
        source: "WEB",
      });
      return { onBreak: true, breakMinutes: record.breakMinutes };
    }

    if (!openBreak) throw errors.precondition("You're not on a break.");

    const minutes = Math.max(0, Math.round((now.getTime() - openBreak.startedAt.getTime()) / 60_000));
    await attendanceRepository.endBreak(scope, openBreak.id, now, minutes);
    const totalBreakMinutes = await attendanceRepository.totalBreakMinutes(scope, record.id);

    await prisma.attendanceRecord.updateMany({
      where: { id: record.id, organizationId: scope.organizationId },
      data: { breakMinutes: totalBreakMinutes },
    });
    await attendanceRepository.createEvent(scope, {
      employeeId: employee.id,
      attendanceRecordId: record.id,
      type: "BREAK_END",
      occurredAt: now,
      verification: "NO_LOCATION",
      source: "WEB",
    });

    return { onBreak: false, breakMinutes: totalBreakMinutes };
  },

  /**
   * HR/admin correction. Requires `attendance:override`, always records an
   * audit entry naming the actor and the reason, and marks the row as manual
   * so reports can distinguish it from a device-verified day.
   */
  async override(session: AuthSession, input: OverrideAttendanceInput) {
    const scope = tenantScopeFor(session);
    const organization = await organizationRepository.policy(scope.organizationId);
    if (!organization.allowManualOverride) {
      throw errors.precondition("Manual attendance edits are disabled for this organisation.");
    }

    const { timezone, workday } = await loadPolicy(scope, input.officeId ?? null);
    const dateKey = zonedDateKey(input.date, timezone);

    const before = await attendanceRepository.findRecord(scope, input.employeeId, dateKey);

    const computed =
      input.checkInAt && input.checkOutAt
        ? computeDay({
            policy: workday,
            checkInMinutes: zonedMinutesOfDay(input.checkInAt, timezone),
            checkOutMinutes: zonedMinutesOfDay(input.checkOutAt, timezone),
            breakMinutes: before?.breakMinutes ?? 0,
            isWeekend: false,
            isHoliday: false,
            isOnApprovedLeave: false,
          })
        : null;

    const saved = await attendanceRepository.upsertRecord(
      scope,
      input.employeeId,
      dateKey,
      {
        officeId: input.officeId ?? null,
        checkInAt: input.checkInAt ?? null,
        checkOutAt: input.checkOutAt ?? null,
        status: input.status,
        workedMinutes: computed?.workedMinutes ?? 0,
        lateByMinutes: computed?.lateByMinutes ?? 0,
        overtimeMinutes: computed?.overtimeMinutes ?? 0,
        isManualEntry: true,
        overrideReason: input.reason,
      },
      {
        officeId: input.officeId ?? null,
        checkInAt: input.checkInAt ?? null,
        checkOutAt: input.checkOutAt ?? null,
        status: input.status,
        ...(computed
          ? {
              workedMinutes: computed.workedMinutes,
              lateByMinutes: computed.lateByMinutes,
              overtimeMinutes: computed.overtimeMinutes,
            }
          : {}),
        isManualEntry: true,
        overrideReason: input.reason,
      },
    );

    await auditService.record(scope, session, {
      action: "ATTENDANCE_OVERRIDE",
      entityType: "attendance_records",
      entityId: saved.id,
      summary: `Manually set attendance for ${saved.employee.firstName} ${saved.employee.lastName} on ${dateKey.toISOString().slice(0, 10)} to ${input.status}`,
      changes: {
        reason: input.reason,
        from: before
          ? { status: before.status, checkInAt: before.checkInAt, checkOutAt: before.checkOutAt }
          : null,
        to: { status: input.status, checkInAt: input.checkInAt, checkOutAt: input.checkOutAt },
      },
    });

    return saved;
  },
};

/** Narrow the raw request body to a location claim, with helpful errors. */
export function parseLocationClaim(schema: z.ZodType<{ location: LocationClaim }>, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw errors.validation("We couldn't read your location.", {
      location: parsed.error.issues.map((issue) => issue.message),
    });
  }
  return parsed.data.location;
}
