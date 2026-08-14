import { z } from "zod";

import {
  geofenceRadiusSchema,
  latitudeSchema,
  longitudeSchema,
  minutesOfDaySchema,
  optionalText,
  text,
  uuidSchema,
} from "@/lib/validation/common";

/**
 * Office and geofence input.
 *
 * Coordinates are always supplied by an administrator through this schema —
 * nothing in the codebase hard-codes an office location, including the seed,
 * which reads its values from a data file rather than embedding them in logic.
 */

const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not a recognised IANA timezone, e.g. Asia/Kolkata" },
  );

export const createOfficeSchema = z
  .object({
    name: text("Office name", 120),
    code: text("Office code", 16)
      .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
      .transform((value) => value.toUpperCase()),
    addressLine: text("Address", 240),
    city: text("City", 80),
    state: optionalText(80),
    country: text("Country", 80).default("India"),
    postalCode: optionalText(16),
    timezone: timezoneSchema.default("Asia/Kolkata"),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radiusMeters: geofenceRadiusSchema.default(100),
    workdayStartMinutes: minutesOfDaySchema.default(540),
    workdayEndMinutes: minutesOfDaySchema.default(1080),
    gracePeriodMinutes: z.number().int().min(0).max(240).default(15),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  })
  .refine((data) => data.workdayEndMinutes > data.workdayStartMinutes, {
    message: "Closing time must be after the opening time",
    path: ["workdayEndMinutes"],
  })
  .refine((data) => !(data.latitude === 0 && data.longitude === 0), {
    message: "Pick a real location — (0, 0) is not a valid office",
    path: ["latitude"],
  });

export type CreateOfficeInput = z.infer<typeof createOfficeSchema>;

export const updateOfficeSchema = z.object({
  name: text("Office name", 120).optional(),
  addressLine: text("Address", 240).optional(),
  city: text("City", 80).optional(),
  state: optionalText(80).nullable(),
  country: text("Country", 80).optional(),
  postalCode: optionalText(16).nullable(),
  timezone: timezoneSchema.optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  workdayStartMinutes: minutesOfDaySchema.optional(),
  workdayEndMinutes: minutesOfDaySchema.optional(),
  gracePeriodMinutes: z.number().int().min(0).max(240).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type UpdateOfficeInput = z.infer<typeof updateOfficeSchema>;

/** Geofence edits are separate from office edits so they audit independently. */
export const upsertGeofenceSchema = z.object({
  id: uuidSchema.optional(),
  name: text("Zone name", 80).default("Main perimeter"),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusMeters: geofenceRadiusSchema,
  isPrimary: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export type UpsertGeofenceInput = z.infer<typeof upsertGeofenceSchema>;

export const assignEmployeeOfficesSchema = z.object({
  officeIds: z.array(uuidSchema).max(20, "An employee can be assigned at most 20 offices"),
});
