import { z } from "zod";

import {
  dateSchema,
  emailSchema,
  minutesOfDaySchema,
  optionalDateSchema,
  optionalPhoneSchema,
  optionalText,
  paginationSchema,
  searchSchema,
  text,
  uuidSchema,
} from "@/lib/validation/common";

export const employeeStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED"]);
export const employmentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERN",
  "CONSULTANT",
]);

/**
 * Note what this schema does NOT accept: `organizationId`. Tenant scope comes
 * from the server session, so a caller cannot create an employee inside
 * someone else's organisation by adding a field.
 */
export const createEmployeeSchema = z
  .object({
    employeeCode: text("Employee ID", 24)
      .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
      .transform((value) => value.toUpperCase()),
    firstName: text("First name", 60),
    lastName: text("Last name", 60),
    email: emailSchema,
    phone: optionalPhoneSchema,
    avatarUrl: z.string().url("Enter a valid image URL").optional().or(z.literal("").transform(() => undefined)),
    designation: text("Designation", 80),
    bio: optionalText(600),
    departmentId: uuidSchema.optional().nullable(),
    managerId: uuidSchema.optional().nullable(),
    primaryOfficeId: uuidSchema.optional().nullable(),
    employmentType: employmentTypeSchema.default("FULL_TIME"),
    status: employeeStatusSchema.default("ACTIVE"),
    joinedAt: dateSchema,
    exitedAt: optionalDateSchema,
    shiftStartMinutes: minutesOfDaySchema.optional().nullable(),
    shiftEndMinutes: minutesOfDaySchema.optional().nullable(),
  })
  .refine((data) => !data.exitedAt || data.exitedAt >= data.joinedAt, {
    message: "Exit date cannot be before the joining date",
    path: ["exitedAt"],
  })
  .refine(
    (data) =>
      data.shiftStartMinutes == null ||
      data.shiftEndMinutes == null ||
      data.shiftEndMinutes > data.shiftStartMinutes,
    { message: "Shift end must be after the shift start", path: ["shiftEndMinutes"] },
  );

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** Partial update. `id` travels in the URL, not the body. */
export const updateEmployeeSchema = z.object({
  firstName: text("First name", 60).optional(),
  lastName: text("Last name", 60).optional(),
  email: emailSchema.optional(),
  phone: optionalPhoneSchema,
  avatarUrl: z.string().url().optional().nullable(),
  designation: text("Designation", 80).optional(),
  bio: optionalText(600),
  departmentId: uuidSchema.nullable().optional(),
  managerId: uuidSchema.nullable().optional(),
  primaryOfficeId: uuidSchema.nullable().optional(),
  employmentType: employmentTypeSchema.optional(),
  status: employeeStatusSchema.optional(),
  joinedAt: dateSchema.optional(),
  exitedAt: optionalDateSchema.nullable(),
  shiftStartMinutes: minutesOfDaySchema.nullable().optional(),
  shiftEndMinutes: minutesOfDaySchema.nullable().optional(),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeQuerySchema = paginationSchema.extend({
  search: searchSchema,
  status: employeeStatusSchema.optional(),
  departmentId: uuidSchema.optional(),
  officeId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  managerId: uuidSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  sortBy: z.enum(["name", "joinedAt", "designation", "department"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;

export const EMPLOYEE_STATUS_LABELS: Record<z.infer<typeof employeeStatusSchema>, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On leave",
  SUSPENDED: "Suspended",
};

export const EMPLOYMENT_TYPE_LABELS: Record<z.infer<typeof employmentTypeSchema>, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
  CONSULTANT: "Consultant",
};
