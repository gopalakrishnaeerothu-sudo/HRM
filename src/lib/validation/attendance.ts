import { z } from "zod";

import {
  dateSchema,
  locationClaimSchema,
  optionalText,
  paginationSchema,
  text,
  uuidSchema,
} from "@/lib/validation/common";

export const attendanceStatusSchema = z.enum([
  "PRESENT",
  "ABSENT",
  "LATE",
  "HALF_DAY",
  "ON_LEAVE",
  "HOLIDAY",
  "WEEKEND",
]);

export type AttendanceStatusValue = z.infer<typeof attendanceStatusSchema>;

/**
 * Check-in payload.
 *
 * The client sends coordinates and nothing more. There is deliberately no
 * `officeId`, no `distanceMeters` and no `isInsideOffice` — the server resolves
 * the employee's assigned offices from the session and computes the verdict
 * itself. Adding any of those fields here would create exactly the trust
 * boundary this design avoids.
 */
export const checkInSchema = z.object({
  location: locationClaimSchema,
});

export const checkOutSchema = z.object({
  /** Optional: an organisation may require a verified location to check out. */
  location: locationClaimSchema.optional(),
  notes: optionalText(280),
});

export const breakSchema = z.object({
  action: z.enum(["start", "end"]),
  reason: optionalText(120),
});

/**
 * Manual correction by HR or an administrator. Always requires a reason,
 * because it always writes an audit-log entry naming who changed what.
 */
export const overrideAttendanceSchema = z
  .object({
    employeeId: uuidSchema,
    date: dateSchema,
    status: attendanceStatusSchema,
    checkInAt: z.coerce.date().optional().nullable(),
    checkOutAt: z.coerce.date().optional().nullable(),
    officeId: uuidSchema.optional().nullable(),
    reason: text("Reason", 280, 10),
  })
  .refine((data) => !data.checkInAt || !data.checkOutAt || data.checkOutAt > data.checkInAt, {
    message: "Check-out must be after check-in",
    path: ["checkOutAt"],
  });

export type OverrideAttendanceInput = z.infer<typeof overrideAttendanceSchema>;

export const attendanceQuerySchema = paginationSchema.extend({
  employeeId: uuidSchema.optional(),
  officeId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  status: attendanceStatusSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  /** Scope is intersected with the caller's permissions, never widened by it. */
  scope: z.enum(["self", "team", "organization"]).default("self"),
});

export type AttendanceQuery = z.infer<typeof attendanceQuerySchema>;

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  HALF_DAY: "Half day",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKEND: "Weekend",
};

/** Statuses that count towards "attended" in reports. */
export const PRESENT_STATUSES: AttendanceStatusValue[] = ["PRESENT", "LATE", "HALF_DAY"];

// --- Leave ------------------------------------------------------------------

export const leaveTypeSchema = z.enum([
  "CASUAL",
  "SICK",
  "EARNED",
  "UNPAID",
  "MATERNITY",
  "PATERNITY",
  "COMP_OFF",
]);

export const requestLeaveSchema = z
  .object({
    type: leaveTypeSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    /** Halves allowed, hence 0.5 steps rather than an integer. */
    days: z.number().min(0.5).max(180).multipleOf(0.5),
    reason: text("Reason", 500, 5),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date cannot be before the start date",
    path: ["endDate"],
  });

export const reviewLeaveSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: optionalText(400),
});

export const LEAVE_TYPE_LABELS: Record<z.infer<typeof leaveTypeSchema>, string> = {
  CASUAL: "Casual leave",
  SICK: "Sick leave",
  EARNED: "Earned leave",
  UNPAID: "Unpaid leave",
  MATERNITY: "Maternity leave",
  PATERNITY: "Paternity leave",
  COMP_OFF: "Comp off",
};
