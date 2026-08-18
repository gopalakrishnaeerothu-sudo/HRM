import { afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";

import { offsetByMeters } from "@/server/geo/distance";
import { verifyLocation, DEFAULT_POLICY } from "@/server/geo/verify";
import { attendanceRepository, toDateKey } from "@/server/repositories/attendance-repository";
import { officeRepository } from "@/server/repositories/office-repository";
import type { TenantScope } from "@/server/db/tenant";
import { computeDay } from "@/server/services/attendance-rules";
import {
  createTenant,
  disconnectTestDb,
  hasTestDatabase,
  resetDatabase,
  testDb,
} from "../helpers/db";

/**
 * Attendance persistence, end to end through the repository layer.
 *
 * Exercises the two paths that matter: a check-in inside the perimeter that
 * creates a record, and one outside it that creates only an event. The second
 * is the important assertion — a refused attempt must still be logged, or
 * repeated probing would be invisible.
 */
describe.skipIf(!hasTestDatabase)("attendance flow", () => {
  let tenant: Awaited<ReturnType<typeof createTenant>>;
  let scope: TenantScope;

  beforeEach(async () => {
    await resetDatabase();
    tenant = await createTenant({ slug: "attendance-co", name: "Attendance Co" });
    scope = { organizationId: tenant.organization.id };
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  const office = () => ({ latitude: 16.30656, longitude: 80.4365 });

  it("records a verified check-in and its event", async () => {
    const zones = await officeRepository.listZonesForEmployee(scope, tenant.employee.id);
    expect(zones).toHaveLength(1);

    const now = new Date("2026-08-10T03:44:00Z"); // 09:14 IST
    const reported = { ...offsetByMeters(office(), 42, 0), accuracyMeters: 11 };

    const verdict = verifyLocation({
      reported,
      capturedAt: now,
      now,
      zones,
      previousFix: null,
      policy: DEFAULT_POLICY,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.verification).toBe("VERIFIED");

    const computed = computeDay({
      policy: {
        startMinutes: 540,
        endMinutes: 1080,
        gracePeriodMinutes: 15,
        fullDayHours: 8,
        halfDayHours: 4,
      },
      checkInMinutes: 9 * 60 + 14,
      checkOutMinutes: null,
      breakMinutes: 0,
      isWeekend: false,
      isHoliday: false,
      isOnApprovedLeave: false,
    });

    const record = await attendanceRepository.upsertRecord(
      scope,
      tenant.employee.id,
      now,
      {
        officeId: tenant.office.id,
        checkInAt: now,
        status: computed.status,
        lateByMinutes: computed.lateByMinutes,
      },
    );

    expect(record.status).toBe("PRESENT");
    expect(record.lateByMinutes).toBe(0);

    await attendanceRepository.createEvent(scope, {
      employeeId: tenant.employee.id,
      attendanceRecordId: record.id,
      officeId: tenant.office.id,
      geofenceId: zones[0]!.id,
      type: "CHECK_IN",
      occurredAt: now,
      latitude: reported.latitude,
      longitude: reported.longitude,
      accuracyMeters: reported.accuracyMeters,
      distanceMeters: verdict.distanceMeters,
      verification: verdict.verification,
      riskFlags: verdict.riskFlags,
    });

    const events = await testDb().attendanceEvent.findMany({
      where: { attendanceRecordId: record.id },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.verification).toBe("VERIFIED");
    expect(events[0]?.distanceMeters).toBeCloseTo(42, 0);
  });

  it("logs a refused check-in without creating an attendance record", async () => {
    const zones = await officeRepository.listZonesForEmployee(scope, tenant.employee.id);
    const now = new Date("2026-08-10T03:44:00Z");
    const reported = { ...offsetByMeters(office(), 248, 0), accuracyMeters: 10 };

    const verdict = verifyLocation({
      reported,
      capturedAt: now,
      now,
      zones,
      previousFix: null,
      policy: DEFAULT_POLICY,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.verification).toBe("OUTSIDE_GEOFENCE");

    // The refusal is still written — this is the audit trail that makes
    // repeated boundary probing detectable.
    await attendanceRepository.createEvent(scope, {
      employeeId: tenant.employee.id,
      officeId: tenant.office.id,
      type: "CHECK_IN",
      occurredAt: now,
      latitude: reported.latitude,
      longitude: reported.longitude,
      accuracyMeters: reported.accuracyMeters,
      distanceMeters: verdict.distanceMeters,
      verification: verdict.verification,
      riskFlags: verdict.riskFlags,
    });

    const record = await attendanceRepository.findRecord(scope, tenant.employee.id, now);
    expect(record).toBeNull();

    const flagged = await attendanceRepository.listFlaggedEvents(scope, 10);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.verification).toBe("OUTSIDE_GEOFENCE");
    expect(flagged[0]?.riskFlags).toContain("OUTSIDE_ALL_GEOFENCES");
  });

  it("keeps one record per employee per day under concurrent upserts", async () => {
    const day = new Date("2026-08-10T03:44:00Z");

    // Two simultaneous check-ins must not create two rows — the composite
    // unique on (employeeId, date) is what guarantees that.
    await Promise.all([
      attendanceRepository.upsertRecord(
        scope,
        tenant.employee.id,
        day,
        { checkInAt: day, status: "PRESENT" },
      ),
      attendanceRepository.upsertRecord(
        scope,
        tenant.employee.id,
        day,
        { checkInAt: day, status: "PRESENT" },
      ),
    ]).catch(() => {
      // A unique-violation from the losing upsert is an acceptable outcome;
      // what matters is the row count below.
    });

    const rows = await testDb().attendanceRecord.findMany({
      where: { employeeId: tenant.employee.id, date: toDateKey(day) },
    });

    expect(rows).toHaveLength(1);
  });

  it("finds the last accepted fix and ignores refused ones", async () => {
    const base = new Date("2026-08-10T03:00:00Z");

    await attendanceRepository.createEvent(scope, {
      employeeId: tenant.employee.id,
      type: "CHECK_IN",
      occurredAt: base,
      latitude: 16.3,
      longitude: 80.43,
      verification: "VERIFIED",
    });

    // A later but REFUSED event must not become the travel-check baseline.
    await attendanceRepository.createEvent(scope, {
      employeeId: tenant.employee.id,
      type: "CHECK_IN",
      occurredAt: new Date(base.getTime() + 3_600_000),
      latitude: 28.6139,
      longitude: 77.209,
      verification: "OUTSIDE_GEOFENCE",
    });

    const fix = await attendanceRepository.findLastAcceptedFix(scope, tenant.employee.id);

    expect(fix).not.toBeNull();
    expect(fix?.latitude).toBeCloseTo(16.3, 4);
  });

  it("counts events in the rate-limit window", async () => {
    const now = new Date();

    for (let index = 0; index < 3; index += 1) {
      await attendanceRepository.createEvent(scope, {
        employeeId: tenant.employee.id,
        type: "CHECK_IN",
        occurredAt: new Date(now.getTime() - index * 1000),
        verification: "NO_LOCATION",
      });
    }

    const recent = await attendanceRepository.countRecentEvents(scope, tenant.employee.id, 60);
    expect(recent).toBe(3);
  });

  it("computes a full day from check-in to check-out", async () => {
    const checkIn = new Date("2026-08-10T03:30:00Z"); // 09:00 IST
    const checkOut = new Date("2026-08-10T12:30:00Z"); // 18:00 IST

    const computed = computeDay({
      policy: {
        startMinutes: 540,
        endMinutes: 1080,
        gracePeriodMinutes: 15,
        fullDayHours: 8,
        halfDayHours: 4,
      },
      checkInMinutes: 9 * 60,
      checkOutMinutes: 18 * 60,
      breakMinutes: 45,
      isWeekend: false,
      isHoliday: false,
      isOnApprovedLeave: false,
    });

    const record = await attendanceRepository.upsertRecord(
      scope,
      tenant.employee.id,
      checkIn,
      {
        checkInAt: checkIn,
        checkOutAt: checkOut,
        status: computed.status,
        workedMinutes: computed.workedMinutes,
        breakMinutes: 45,
        overtimeMinutes: computed.overtimeMinutes,
      },
    );

    expect(record.status).toBe("PRESENT");
    expect(record.workedMinutes).toBe(495); // 9h − 45m
    expect(record.overtimeMinutes).toBe(15);
  });
});
