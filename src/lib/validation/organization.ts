import { z } from "zod";

import { hexColorSchema, minutesOfDaySchema, optionalText, text, uuidSchema } from "@/lib/validation/common";

// --- Teams & departments ----------------------------------------------------

export const createTeamSchema = z.object({
  name: text("Team name", 80),
  description: optionalText(400),
  color: hexColorSchema.default("#8b5cf6"),
  departmentId: uuidSchema.optional().nullable(),
  managerId: uuidSchema.optional().nullable(),
  memberIds: z.array(uuidSchema).max(200, "A team can hold at most 200 members").default([]),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema.partial();

export const createDepartmentSchema = z.object({
  name: text("Department name", 80),
  code: text("Code", 12)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
    .transform((value) => value.toUpperCase()),
  description: optionalText(400),
  color: hexColorSchema.default("#6366f1"),
  headId: uuidSchema.optional().nullable(),
});

// --- Organisation settings --------------------------------------------------

export const organizationProfileSchema = z.object({
  name: text("Organisation name", 120),
  legalName: optionalText(160),
  logoUrl: z.string().url("Enter a valid image URL").optional().or(z.literal("").transform(() => undefined)),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3, "Use a 3-letter currency code"),
  locale: z.string().trim().min(2).max(10),
});

export const workingHoursSchema = z
  .object({
    workdayStartMinutes: minutesOfDaySchema,
    workdayEndMinutes: minutesOfDaySchema,
    gracePeriodMinutes: z.number().int().min(0).max(240),
    fullDayHours: z.number().min(1).max(24),
    halfDayHours: z.number().min(0.5).max(12),
    /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
    weekendDays: z.array(z.number().int().min(1).max(7)).max(6, "At least one working day is required"),
  })
  .refine((data) => data.workdayEndMinutes > data.workdayStartMinutes, {
    message: "The workday must end after it starts",
    path: ["workdayEndMinutes"],
  })
  .refine((data) => data.halfDayHours < data.fullDayHours, {
    message: "Half-day hours must be less than full-day hours",
    path: ["halfDayHours"],
  });

/**
 * Attendance policy. `enforceGeofence` is the switch that decides whether an
 * out-of-perimeter check-in is rejected or merely flagged; both paths are
 * recorded either way.
 */
export const attendancePolicySchema = z.object({
  maxAccuracyMeters: z
    .number()
    .int()
    .min(20, "Below 20 m almost no device would qualify")
    .max(1000),
  maxTravelSpeedKmh: z.number().int().min(50).max(2000),
  enforceGeofence: z.boolean(),
  allowManualOverride: z.boolean(),
  requireCheckoutLocation: z.boolean(),
});

export const holidaySchema = z.object({
  name: text("Holiday name", 80),
  date: z.coerce.date(),
  isOptional: z.boolean().default(false),
});

export const broadcastNotificationSchema = z.object({
  title: text("Title", 120),
  body: text("Message", 1000),
  linkUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)),
});

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};
