import { z } from "zod";

/**
 * Shared validation primitives.
 *
 * Every schema in this folder is used in two places — the form on the client
 * and the route handler on the server — so a rule can never drift between the
 * two, and the server never trusts that the client ran it.
 */

export const uuidSchema = z.string().uuid("Not a valid identifier");

/** Trimmed, non-empty, length-bounded text. */
export const text = (label: string, max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .or(z.literal("").transform(() => undefined));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .email("Enter a valid email address")
  .max(254);

/** Permissive on formatting, strict on content: 7–20 digits after cleanup. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+()\d][\d\s()+-]{6,24}$/, "Enter a valid phone number")
  .transform((value) => value.replace(/\s+/g, " "));

export const optionalPhoneSchema = phoneSchema.optional().or(z.literal("").transform(() => undefined));

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #4f46e5");

/** ISO date string or Date, normalised to a Date. */
export const dateSchema = z.coerce.date({ invalid_type_error: "Enter a valid date" });

export const optionalDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.date().optional(),
);

/** "HH:MM" 24-hour clock, stored as minutes from midnight. */
export const clockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use 24-hour time, e.g. 09:00")
  .transform((value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  });

export const minutesOfDaySchema = z
  .number()
  .int("Must be a whole number of minutes")
  .min(0, "Cannot be before midnight")
  .max(1439, "Cannot be after 23:59");

// --- Geography --------------------------------------------------------------

export const latitudeSchema = z
  .number({ invalid_type_error: "Latitude must be a number" })
  .finite("Latitude must be a number")
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

export const longitudeSchema = z
  .number({ invalid_type_error: "Longitude must be a number" })
  .finite("Longitude must be a number")
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

/**
 * A geofence radius. The lower bound is not arbitrary: consumer GPS is rarely
 * better than ~10 m, so a radius below 20 m would reject people standing at
 * their own desk.
 */
export const geofenceRadiusSchema = z
  .number()
  .int("Radius must be a whole number of metres")
  .min(20, "Radius must be at least 20 m — GPS is not precise enough below that")
  .max(5000, "Radius must be 5,000 m or less");

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

/**
 * What a client may send about its location. Note what is absent: there is no
 * "isInsideOffice" field, and no office id. The server derives both.
 */
export const locationClaimSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyMeters: z.number().nonnegative().max(100_000).optional().nullable(),
  /** Device timestamp of the fix, ISO 8601. Cross-checked against the server clock. */
  capturedAt: z.string().datetime({ offset: true }).optional().nullable(),
  /** Opaque, client-generated device identifier used for correlation only. */
  deviceId: z.string().trim().max(128).optional().nullable(),
});

export type LocationClaim = z.infer<typeof locationClaimSchema>;

// --- Collections ------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /** Capped so a client cannot ask for the entire table in one request. */
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(["asc", "desc"]).default("desc");

export const searchSchema = z.string().trim().max(120).optional();

/** Turn a ZodError into the field→messages map the Field component expects. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
