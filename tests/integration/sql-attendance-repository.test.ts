import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Executor } from "@/server/db/query";
import type { TenantScope } from "@/server/db/tenant";
import { sqlAttendanceRepository, toDateKey } from "@/server/repositories/sql/attendance-repository";

import {
  createSqlTenant,
  disconnectSqlTestDb,
  hasSqlTestDatabase,
  resetSqlDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

/**
 * Attendance is the highest-risk table in the system: it is the record an
 * employee is paid from, and the location events beside it are the only
 * evidence of a refused check-in. These tests concentrate on the places where
 * getting it wrong would be silent — a duplicated day, an erased check-in, a
 * rejected GPS fix becoming the baseline for the next comparison.
 */

const describeSql = hasSqlTestDatabase ? describe : describe.skip;

function scopeFor(organizationId: string): TenantScope {
  return { organizationId, tx: sqlTestPool() as unknown as Executor };
}

async function seedEmployee(
  organizationId: string,
  code: string,
  firstName: string,
): Promise<string> {
  const { rows } = await sqlTestPool().query<{ id: string }>(
    `INSERT INTO employees (
       organization_id, employee_code, first_name, last_name, email,
       designation, joined_at, status
     )
     VALUES ($1, $2, $3, 'Tester', $4, 'Engineer', NOW(), 'ACTIVE')
     RETURNING id`,
    [organizationId, code, firstName, `${code.toLowerCase()}@example.test`],
  );

  return rows[0]!.id;
}

const DAY = new Date("2026-03-11T00:00:00.000Z");

describeSql("sql attendance repository", () => {
  let orgId: string;
  let otherOrgId: string;
  let employeeId: string;
  let scope: TenantScope;

  beforeEach(async () => {
    await resetSqlDatabase();
    orgId = await createSqlTenant("attendance-co", "Attendance Co");
    otherOrgId = await createSqlTenant("rival-co", "Rival Co");
    employeeId = await seedEmployee(orgId, "EMP-1", "Asha");
    scope = scopeFor(orgId);
  });

  afterAll(async () => {
    await disconnectSqlTestDb();
  });

  describe("the day's record", () => {
    it("creates one record for a check-in", async () => {
      const record = await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
        checkInAt: new Date("2026-03-11T09:05:00.000Z"),
        status: "PRESENT",
        lateByMinutes: 5,
      });

      expect(record.status).toBe("PRESENT");
      expect(record.lateByMinutes).toBe(5);
      expect(record.checkInAt).not.toBeNull();
      expect(record.employee.firstName).toBe("Asha");
    });

    it("stores the date as the calendar day, not a local-midnight shift", async () => {
      const record = await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
        status: "PRESENT",
      });

      // A DATE parsed into local midnight would move this to the 10th in any
      // timezone behind UTC — the bug that silently misfiles a whole day.
      expect(record.date.toISOString()).toBe("2026-03-11T00:00:00.000Z");
    });

    it("checking out does not erase the check-in", async () => {
      const checkIn = new Date("2026-03-11T09:00:00.000Z");
      await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
        checkInAt: checkIn,
        status: "PRESENT",
      });

      const after = await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
        checkOutAt: new Date("2026-03-11T17:30:00.000Z"),
        status: "PRESENT",
        workedMinutes: 510,
      });

      expect(after.checkInAt?.toISOString()).toBe(checkIn.toISOString());
      expect(after.checkOutAt).not.toBeNull();
      expect(after.workedMinutes).toBe(510);
    });

    it("collapses two simultaneous check-ins into a single row", async () => {
      // The unique constraint, not the application, is what prevents the
      // duplicate. Firing both without awaiting the first proves it.
      await Promise.all([
        sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
          checkInAt: new Date("2026-03-11T09:00:00.000Z"),
          status: "PRESENT",
        }),
        sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
          checkInAt: new Date("2026-03-11T09:00:01.000Z"),
          status: "PRESENT",
        }),
      ]);

      const { rows } = await sqlTestPool().query(
        `SELECT id FROM attendance_records WHERE employee_id = $1 AND date = $2`,
        [employeeId, toDateKey(DAY)],
      );

      expect(rows).toHaveLength(1);
    });

    it("does not return another tenant's record", async () => {
      await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, { status: "PRESENT" });

      const found = await sqlAttendanceRepository.findRecord(
        scopeFor(otherOrgId),
        employeeId,
        DAY,
      );

      expect(found).toBeNull();
    });
  });

  describe("location events", () => {
    it("records a refused attempt even though no attendance record exists", async () => {
      await sqlAttendanceRepository.createEvent(scope, {
        employeeId,
        type: "CHECK_IN",
        verification: "OUTSIDE_GEOFENCE",
        latitude: 16.3067,
        longitude: 80.4365,
        distanceMeters: 4200,
        riskFlags: ["OUTSIDE_RADIUS"],
      });

      const record = await sqlAttendanceRepository.findRecord(scope, employeeId, DAY);
      expect(record).toBeNull();

      const flagged = await sqlAttendanceRepository.listFlaggedEvents(scope);
      expect(flagged).toHaveLength(1);
      expect(flagged[0]!.verification).toBe("OUTSIDE_GEOFENCE");
      expect(flagged[0]!.riskFlags).toEqual(["OUTSIDE_RADIUS"]);
    });

    it("never uses a rejected fix as the impossible-travel baseline", async () => {
      await sqlAttendanceRepository.createEvent(scope, {
        employeeId,
        type: "CHECK_IN",
        verification: "VERIFIED",
        latitude: 17.385,
        longitude: 78.4867,
        occurredAt: new Date("2026-03-11T09:00:00.000Z"),
      });

      // Later in time, but rejected — it must not displace the verified fix.
      await sqlAttendanceRepository.createEvent(scope, {
        employeeId,
        type: "CHECK_IN",
        verification: "SUSPECTED_SPOOF",
        latitude: 51.5072,
        longitude: -0.1276,
        occurredAt: new Date("2026-03-11T09:02:00.000Z"),
      });

      const last = await sqlAttendanceRepository.findLastAcceptedFix(scope, employeeId);

      expect(last).not.toBeNull();
      expect(last!.latitude).toBeCloseTo(17.385, 3);
      expect(last!.longitude).toBeCloseTo(78.4867, 3);
    });

    it("ignores a verified fix belonging to another tenant", async () => {
      await sqlAttendanceRepository.createEvent(scope, {
        employeeId,
        type: "CHECK_IN",
        verification: "VERIFIED",
        latitude: 17.385,
        longitude: 78.4867,
      });

      const last = await sqlAttendanceRepository.findLastAcceptedFix(
        scopeFor(otherOrgId),
        employeeId,
      );

      expect(last).toBeNull();
    });

    it("counts recent attempts for the burst check", async () => {
      for (let index = 0; index < 3; index += 1) {
        await sqlAttendanceRepository.createEvent(scope, {
          employeeId,
          type: "CHECK_IN",
          verification: "OUTSIDE_GEOFENCE",
        });
      }

      expect(await sqlAttendanceRepository.countRecentEvents(scope, employeeId, 300)).toBe(3);
    });

    it("refuses to update an event once written", async () => {
      const id = await sqlAttendanceRepository.createEvent(scope, {
        employeeId,
        type: "CHECK_IN",
        verification: "OUTSIDE_GEOFENCE",
      });

      await expect(
        sqlTestPool().query(`UPDATE attendance_events SET verification = 'VERIFIED' WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/append-only/i);
    });
  });

  describe("breaks", () => {
    let recordId: string;

    beforeEach(async () => {
      const record = await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
        checkInAt: new Date("2026-03-11T09:00:00.000Z"),
        status: "PRESENT",
      });
      recordId = record.id;
    });

    it("starts, finds and ends a break", async () => {
      const breakId = await sqlAttendanceRepository.startBreak(scope, {
        employeeId,
        attendanceRecordId: recordId,
        startedAt: new Date("2026-03-11T13:00:00.000Z"),
        reason: "Lunch",
      });

      const open = await sqlAttendanceRepository.findOpenBreak(scope, recordId);
      expect(open?.id).toBe(breakId);

      const ended = await sqlAttendanceRepository.endBreak(
        scope,
        breakId,
        new Date("2026-03-11T13:35:00.000Z"),
        35,
      );

      expect(ended).toBe(true);
      expect(await sqlAttendanceRepository.findOpenBreak(scope, recordId)).toBeNull();
      expect(await sqlAttendanceRepository.totalBreakMinutes(scope, recordId)).toBe(35);
    });

    it("will not end the same break twice", async () => {
      const breakId = await sqlAttendanceRepository.startBreak(scope, {
        employeeId,
        attendanceRecordId: recordId,
        startedAt: new Date("2026-03-11T13:00:00.000Z"),
      });

      await sqlAttendanceRepository.endBreak(scope, breakId, new Date(), 30);
      // A second call must not add another 30 minutes to the day.
      const again = await sqlAttendanceRepository.endBreak(scope, breakId, new Date(), 30);

      expect(again).toBe(false);
      expect(await sqlAttendanceRepository.totalBreakMinutes(scope, recordId)).toBe(30);
    });

    it("returns zero break minutes for a day with no breaks", async () => {
      expect(await sqlAttendanceRepository.totalBreakMinutes(scope, recordId)).toBe(0);
    });
  });

  describe("listing and roll-ups", () => {
    beforeEach(async () => {
      const second = await seedEmployee(orgId, "EMP-2", "Vikram");

      await sqlAttendanceRepository.upsertRecord(scope, employeeId, DAY, {
        status: "PRESENT",
        workedMinutes: 480,
      });
      await sqlAttendanceRepository.upsertRecord(scope, second, DAY, {
        status: "LATE",
        lateByMinutes: 22,
      });
      await sqlAttendanceRepository.upsertRecord(
        scope,
        employeeId,
        new Date("2026-03-12T00:00:00.000Z"),
        { status: "PRESENT", workedMinutes: 505 },
      );
    });

    it("paginates newest day first", async () => {
      const page = await sqlAttendanceRepository.list(scope, {}, 1, 2);

      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(2);
      expect(page.hasNext).toBe(true);
      expect(page.hasPrevious).toBe(false);
      expect(page.items[0]!.date.toISOString()).toBe("2026-03-12T00:00:00.000Z");
    });

    it("filters to a single day", async () => {
      const page = await sqlAttendanceRepository.list(scope, { from: DAY, to: DAY }, 1, 20);

      expect(page.total).toBe(2);
    });

    it("counts by status for a day", async () => {
      const counts = await sqlAttendanceRepository.countByStatusForDate(scope, DAY);
      const byStatus = Object.fromEntries(counts.map((row) => [row.status, row.count]));

      expect(byStatus.PRESENT).toBe(1);
      expect(byStatus.LATE).toBe(1);
    });

    it("returns an empty page for another tenant", async () => {
      const page = await sqlAttendanceRepository.list(scopeFor(otherOrgId), {}, 1, 20);

      expect(page.total).toBe(0);
      expect(page.items).toEqual([]);
    });

    it("lists active employees who have not checked in", async () => {
      const third = await seedEmployee(orgId, "EMP-3", "Nadia");

      const missing = await sqlAttendanceRepository.findEmployeesWithoutRecord(scope, DAY);

      expect(missing.map((entry) => entry.id)).toEqual([third]);
    });
  });
});
