import { describe, expect, it } from "vitest";

import {
  attendanceRate,
  computeDay,
  liveWorkedMinutes,
  type WorkdayPolicy,
} from "@/server/services/attendance-rules";

/**
 * Attendance arithmetic — the rules people will argue about.
 *
 * Late, half-day and overtime all have money or trust attached, so each
 * boundary is pinned explicitly rather than tested "around" with a rough value.
 */

const POLICY: WorkdayPolicy = {
  startMinutes: 9 * 60, // 09:00
  endMinutes: 18 * 60, // 18:00
  gracePeriodMinutes: 15, // late from 09:16
  fullDayHours: 8,
  halfDayHours: 4,
};

const base = {
  policy: POLICY,
  breakMinutes: 0,
  isWeekend: false,
  isHoliday: false,
  isOnApprovedLeave: false,
};

describe("lateness", () => {
  it("treats an on-time arrival as present", () => {
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: 18 * 60 });

    expect(result.status).toBe("PRESENT");
    expect(result.lateByMinutes).toBe(0);
  });

  it("treats arrival exactly at the end of the grace period as on time", () => {
    // 09:15 with a 15-minute grace period is the last on-time minute.
    const result = computeDay({ ...base, checkInMinutes: 9 * 60 + 15, checkOutMinutes: 18 * 60 });

    expect(result.status).toBe("PRESENT");
    expect(result.lateByMinutes).toBe(0);
  });

  it("marks one minute past the grace period as late", () => {
    const result = computeDay({ ...base, checkInMinutes: 9 * 60 + 16, checkOutMinutes: 18 * 60 });

    expect(result.status).toBe("LATE");
    expect(result.lateByMinutes).toBe(1);
  });

  it("counts lateness from the end of the grace period, not the start time", () => {
    // 10:00 arrival: 45 minutes past 09:15, not 60 minutes past 09:00.
    const result = computeDay({ ...base, checkInMinutes: 10 * 60, checkOutMinutes: 18 * 60 });
    expect(result.lateByMinutes).toBe(45);
  });

  it("credits an early arrival without going negative", () => {
    const result = computeDay({ ...base, checkInMinutes: 8 * 60, checkOutMinutes: 18 * 60 });
    expect(result.lateByMinutes).toBe(0);
  });
});

describe("worked minutes", () => {
  it("subtracts break time", () => {
    const result = computeDay({
      ...base,
      checkInMinutes: 9 * 60,
      checkOutMinutes: 18 * 60,
      breakMinutes: 45,
    });

    expect(result.workedMinutes).toBe(9 * 60 - 45); // 495
  });

  it("never goes negative when breaks exceed attendance", () => {
    const result = computeDay({
      ...base,
      checkInMinutes: 9 * 60,
      checkOutMinutes: 9 * 60 + 30,
      breakMinutes: 120,
    });

    expect(result.workedMinutes).toBe(0);
  });

  it("is zero when the check-out precedes the check-in", () => {
    // Data corruption, not an overnight shift — refuse to invent hours.
    const result = computeDay({ ...base, checkInMinutes: 18 * 60, checkOutMinutes: 9 * 60 });
    expect(result.workedMinutes).toBe(0);
  });
});

describe("half days", () => {
  it("marks a day below the half-day threshold as a half day", () => {
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: 12 * 60 });

    expect(result.workedMinutes).toBe(180);
    expect(result.status).toBe("HALF_DAY");
  });

  it("treats exactly the half-day threshold as a full attendance day", () => {
    // 4 hours exactly is not *below* the threshold.
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: 13 * 60 });

    expect(result.workedMinutes).toBe(240);
    expect(result.status).toBe("PRESENT");
  });

  it("half day takes precedence over lateness", () => {
    const result = computeDay({ ...base, checkInMinutes: 11 * 60, checkOutMinutes: 13 * 60 });

    expect(result.status).toBe("HALF_DAY");
    // Lateness is still recorded even though the status reports the half day.
    expect(result.lateByMinutes).toBe(105);
  });
});

describe("overtime", () => {
  it("is zero for a standard day", () => {
    const result = computeDay({
      ...base,
      checkInMinutes: 9 * 60,
      checkOutMinutes: 17 * 60,
      breakMinutes: 0,
    });

    expect(result.workedMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(0);
  });

  it("counts time beyond the full-day target", () => {
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: 19 * 60 });

    expect(result.workedMinutes).toBe(600);
    expect(result.overtimeMinutes).toBe(120);
  });

  it("measures overtime against hours worked, not the clock", () => {
    // In at 09:00, out at 19:00, but two hours of break — exactly 8h worked.
    const result = computeDay({
      ...base,
      checkInMinutes: 9 * 60,
      checkOutMinutes: 19 * 60,
      breakMinutes: 120,
    });

    expect(result.overtimeMinutes).toBe(0);
  });
});

describe("early departure", () => {
  it("records minutes left before the workday ends", () => {
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: 17 * 60 });
    expect(result.earlyByMinutes).toBe(60);
  });

  it("is zero when leaving after the end of the day", () => {
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: 19 * 60 });
    expect(result.earlyByMinutes).toBe(0);
  });
});

describe("status precedence", () => {
  it("puts approved leave above everything else", () => {
    const result = computeDay({
      ...base,
      checkInMinutes: 9 * 60,
      checkOutMinutes: 18 * 60,
      isOnApprovedLeave: true,
      isHoliday: true,
      isWeekend: true,
    });

    expect(result.status).toBe("ON_LEAVE");
  });

  it("puts a holiday above a weekend and above presence", () => {
    const result = computeDay({
      ...base,
      checkInMinutes: 9 * 60,
      checkOutMinutes: 18 * 60,
      isHoliday: true,
      isWeekend: true,
    });

    expect(result.status).toBe("HOLIDAY");
    // Hours are still recorded — someone who worked a holiday worked it.
    expect(result.workedMinutes).toBe(540);
  });

  it("marks a weekend as a weekend even with a check-in", () => {
    const result = computeDay({
      ...base,
      checkInMinutes: 10 * 60,
      checkOutMinutes: 14 * 60,
      isWeekend: true,
    });

    expect(result.status).toBe("WEEKEND");
  });

  it("marks a working day with no check-in as absent", () => {
    const result = computeDay({ ...base, checkInMinutes: null, checkOutMinutes: null });

    expect(result.status).toBe("ABSENT");
    expect(result.workedMinutes).toBe(0);
  });
});

describe("still checked in", () => {
  it("reports presence rather than a half day before check-out", () => {
    // No check-out yet, so worked minutes are 0 — but the person is clearly in.
    const result = computeDay({ ...base, checkInMinutes: 9 * 60, checkOutMinutes: null });

    expect(result.status).toBe("PRESENT");
    expect(result.workedMinutes).toBe(0);
  });

  it("reports late when the open day started late", () => {
    const result = computeDay({ ...base, checkInMinutes: 10 * 60, checkOutMinutes: null });
    expect(result.status).toBe("LATE");
  });
});

describe("liveWorkedMinutes", () => {
  const checkIn = new Date("2026-08-08T09:00:00Z");

  it("counts elapsed time", () => {
    const now = new Date("2026-08-08T12:00:00Z");
    expect(liveWorkedMinutes(checkIn, now, 0, null)).toBe(180);
  });

  it("subtracts completed breaks", () => {
    const now = new Date("2026-08-08T12:00:00Z");
    expect(liveWorkedMinutes(checkIn, now, 30, null)).toBe(150);
  });

  it("subtracts an in-progress break", () => {
    const now = new Date("2026-08-08T12:00:00Z");
    const breakStarted = new Date("2026-08-08T11:40:00Z");
    // 180 elapsed − 20 on the current break.
    expect(liveWorkedMinutes(checkIn, now, 0, breakStarted)).toBe(160);
  });

  it("never returns a negative figure", () => {
    const now = new Date("2026-08-08T09:10:00Z");
    expect(liveWorkedMinutes(checkIn, now, 120, null)).toBe(0);
  });
});

describe("attendanceRate", () => {
  it("excludes weekends and holidays from the denominator", () => {
    const summary = attendanceRate([
      { status: "PRESENT" },
      { status: "LATE" },
      { status: "ABSENT" },
      { status: "WEEKEND" },
      { status: "WEEKEND" },
      { status: "HOLIDAY" },
    ]);

    expect(summary.workingDays).toBe(3);
    expect(summary.attendedDays).toBe(2);
    expect(summary.rate).toBeCloseTo(2 / 3, 5);
  });

  it("counts half days as attended", () => {
    const summary = attendanceRate([{ status: "HALF_DAY" }, { status: "PRESENT" }]);
    expect(summary.attendedDays).toBe(2);
    expect(summary.rate).toBe(1);
  });

  it("counts approved leave as a working day not attended", () => {
    // Leave is a working day someone did not attend — otherwise a month of
    // leave would show a perfect attendance rate.
    const summary = attendanceRate([{ status: "ON_LEAVE" }, { status: "PRESENT" }]);

    expect(summary.workingDays).toBe(2);
    expect(summary.attendedDays).toBe(1);
    expect(summary.rate).toBe(0.5);
  });

  it("returns zero rather than dividing by zero for an empty period", () => {
    const summary = attendanceRate([]);
    expect(summary.rate).toBe(0);
    expect(summary.workingDays).toBe(0);
  });
});
