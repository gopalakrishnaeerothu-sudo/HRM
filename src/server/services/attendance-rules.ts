import type { AttendanceStatus } from "@/server/db/types";

/**
 * Pure attendance arithmetic.
 *
 * Kept free of I/O and of Prisma types beyond the status enum, so the rules
 * that decide whether someone was late — the ones people will argue about —
 * are directly unit-testable. `attendance-service.ts` supplies the data.
 */

export interface WorkdayPolicy {
  /** Minutes from local midnight. */
  startMinutes: number;
  endMinutes: number;
  /** Minutes after `startMinutes` before an arrival counts as late. */
  gracePeriodMinutes: number;
  fullDayHours: number;
  halfDayHours: number;
}

export interface DayComputationInput {
  policy: WorkdayPolicy;
  /** Local minute-of-day of the check-in, or null if there was none. */
  checkInMinutes: number | null;
  checkOutMinutes: number | null;
  breakMinutes: number;
  isWeekend: boolean;
  isHoliday: boolean;
  isOnApprovedLeave: boolean;
}

export interface DayComputationResult {
  status: AttendanceStatus;
  workedMinutes: number;
  lateByMinutes: number;
  earlyByMinutes: number;
  overtimeMinutes: number;
}

/**
 * Derive a day's attendance figures.
 *
 * Precedence is deliberate: leave beats holiday beats weekend beats presence.
 * An employee who checks in on a holiday still shows HOLIDAY on their record —
 * the hours are recorded, but the day is not counted as a working day.
 */
export function computeDay(input: DayComputationInput): DayComputationResult {
  const { policy, checkInMinutes, checkOutMinutes, breakMinutes } = input;

  const grossMinutes =
    checkInMinutes !== null && checkOutMinutes !== null && checkOutMinutes > checkInMinutes
      ? checkOutMinutes - checkInMinutes
      : 0;

  const workedMinutes = Math.max(0, grossMinutes - Math.max(0, breakMinutes));

  const lateThreshold = policy.startMinutes + policy.gracePeriodMinutes;
  const lateByMinutes =
    checkInMinutes !== null && checkInMinutes > lateThreshold ? checkInMinutes - lateThreshold : 0;

  const earlyByMinutes =
    checkOutMinutes !== null && checkOutMinutes < policy.endMinutes ? policy.endMinutes - checkOutMinutes : 0;

  const fullDayMinutes = policy.fullDayHours * 60;
  const halfDayMinutes = policy.halfDayHours * 60;
  const overtimeMinutes = workedMinutes > fullDayMinutes ? Math.round(workedMinutes - fullDayMinutes) : 0;

  const status = resolveStatus({
    ...input,
    workedMinutes,
    lateByMinutes,
    halfDayMinutes,
    hasCheckIn: checkInMinutes !== null,
  });

  return {
    status,
    workedMinutes: Math.round(workedMinutes),
    lateByMinutes: Math.round(lateByMinutes),
    earlyByMinutes: Math.round(earlyByMinutes),
    overtimeMinutes,
  };
}

function resolveStatus(input: {
  isOnApprovedLeave: boolean;
  isHoliday: boolean;
  isWeekend: boolean;
  hasCheckIn: boolean;
  workedMinutes: number;
  lateByMinutes: number;
  halfDayMinutes: number;
}): AttendanceStatus {
  if (input.isOnApprovedLeave) return "ON_LEAVE";
  if (input.isHoliday) return "HOLIDAY";
  if (input.isWeekend) return "WEEKEND";
  if (!input.hasCheckIn) return "ABSENT";

  // Still checked in (no check-out yet): worked minutes are 0, but the person
  // is demonstrably present, so report presence rather than a half day.
  if (input.workedMinutes === 0) {
    return input.lateByMinutes > 0 ? "LATE" : "PRESENT";
  }

  if (input.workedMinutes < input.halfDayMinutes) return "HALF_DAY";
  if (input.lateByMinutes > 0) return "LATE";
  return "PRESENT";
}

/** Minutes worked so far today for an open (checked-in, not out) record. */
export function liveWorkedMinutes(
  checkInAt: Date,
  now: Date,
  breakMinutes: number,
  openBreakStartedAt: Date | null,
): number {
  const elapsed = Math.max(0, (now.getTime() - checkInAt.getTime()) / 60_000);
  const openBreak = openBreakStartedAt
    ? Math.max(0, (now.getTime() - openBreakStartedAt.getTime()) / 60_000)
    : 0;
  return Math.max(0, Math.round(elapsed - breakMinutes - openBreak));
}

/** Attendance rate over a set of day records, excluding non-working days. */
export function attendanceRate(
  records: ReadonlyArray<{ status: AttendanceStatus }>,
): { rate: number; workingDays: number; attendedDays: number } {
  const workingDays = records.filter(
    (record) => record.status !== "WEEKEND" && record.status !== "HOLIDAY",
  ).length;

  const attendedDays = records.filter(
    (record) => record.status === "PRESENT" || record.status === "LATE" || record.status === "HALF_DAY",
  ).length;

  return {
    rate: workingDays === 0 ? 0 : attendedDays / workingDays,
    workingDays,
    attendedDays,
  };
}

/** Badge tone per status. Always rendered alongside the status *word*. */
export type AttendanceTone =
  | "success"
  | "warning"
  | "serious"
  | "critical"
  | "info"
  | "brand"
  | "neutral";

export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, AttendanceTone> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "critical",
  HALF_DAY: "serious",
  ON_LEAVE: "info",
  HOLIDAY: "brand",
  WEEKEND: "neutral",
};
