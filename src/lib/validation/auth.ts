import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password";

/**
 * Authentication input schemas.
 *
 * ─── Asymmetry is deliberate ────────────────────────────────────────────────
 * Sign-in accepts any non-empty password up to the length cap; it does not
 * apply the password policy. The stored password was whatever it was when it
 * was set, and rejecting it at the door because it no longer meets a policy
 * we tightened later would lock out a valid account without explaining why.
 * The policy belongs where a password is *chosen*.
 *
 * The length cap applies everywhere, including sign-in: it bounds the work an
 * unauthenticated caller can make the server do, since every submitted
 * password costs an Argon2 verification.
 */

const email = z
  .string()
  .min(1, "Enter your email address.")
  .max(320, "That email address is too long.")
  .email("That doesn't look like an email address.")
  // Normalised here so the schema is the single place it happens; the lookup
  // is by lower(email) and the unique index matches.
  .transform((value) => value.trim().toLowerCase());

export const signInSchema = z.object({
  email,
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX_LENGTH, "That password is too long."),
});

/** A password being *chosen* — this is where the policy applies. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Those passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "Choose a password different from your current one.",
    path: ["newPassword"],
  });

export const requestPasswordResetSchema = z.object({ email });

export const completePasswordResetSchema = z
  .object({
    token: z.string().min(1, "This reset link is incomplete."),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Those passwords don't match.",
    path: ["confirmPassword"],
  });

/**
 * Self-signup.
 *
 * ─── What is deliberately absent ────────────────────────────────────────────
 * There is no `role` field and no `organizationId` field, and adding either
 * would be the bug this feature exists to prevent. The role is fixed at
 * EMPLOYEE by the server; the organisation is resolved from the join code.
 * Because neither appears in the schema, a caller who posts them has them
 * stripped by Zod before any handler sees them — the protection is structural
 * rather than a check someone has to remember to write.
 */
export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .min(2, "Enter your full name.")
      .max(120, "That name is too long.")
      .transform((value) => value.trim()),
    email,
    // Loose on format, strict on length: phone numbering plans vary enough
    // that a regex here would reject real numbers, and this field is contact
    // information rather than something the system authenticates against.
    phone: z
      .string()
      .min(6, "Enter a phone number we can reach you on.")
      .max(32, "That phone number is too long.")
      .regex(/^[0-9+()\-.\s]+$/, "Use digits, spaces and + ( ) - only.")
      .transform((value) => value.trim()),
    organizationCode: z
      .string()
      .min(1, "Enter the code your administrator gave you.")
      .max(40, "That code is too long.")
      .transform((value) => value.toUpperCase().replace(/[\s-]/g, "")),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Those passwords don't match.",
    path: ["confirmPassword"],
  });

/**
 * Roles an administrator may hand out through the access surface.
 *
 * OWNER and ADMIN are absent by construction. Whether the *caller* may grant
 * any given value here is a separate, per-actor question answered server-side
 * by `canAssignRole` — this list is the outer bound, not the authorisation.
 */
export const assignableRoleSchema = z.enum(["EMPLOYEE", "MANAGER", "HR"]);

export const approveUserSchema = z.object({
  role: assignableRoleSchema,
  note: z.string().max(500, "That note is too long.").optional(),
});

export const rejectUserSchema = z.object({
  note: z.string().max(500, "That note is too long.").optional(),
});

export const changeRoleSchema = z.object({
  role: assignableRoleSchema,
  /**
   * The role the administrator saw when they opened the menu. Sent back so the
   * write is a compare-and-set — a decision made against a stale table is
   * refused rather than applied to a role that has since changed.
   */
  expectedRole: z.enum(["EMPLOYEE", "MANAGER", "HR", "ADMIN", "OWNER"]),
});

export const setAccessStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED", "LOCKED"]),
  note: z.string().max(500, "That note is too long.").optional(),
});

export const inviteUserSchema = z.object({
  fullName: z
    .string()
    .min(2, "Enter their full name.")
    .max(120, "That name is too long.")
    .transform((value) => value.trim()),
  email,
  phone: z
    .string()
    .max(32, "That phone number is too long.")
    .regex(/^[0-9+()\-.\s]*$/, "Use digits, spaces and + ( ) - only.")
    .optional()
    .transform((value) => value?.trim() || undefined),
  role: assignableRoleSchema,
  departmentId: z.string().uuid("Choose a department.").optional(),
  teamId: z.string().uuid("Choose a team.").optional(),
  designation: z
    .string()
    .max(120, "That job title is too long.")
    .optional()
    .transform((value) => value?.trim() || undefined),
});

export const accessQuerySchema = z.object({
  status: z.enum(["ACTIVE", "PENDING", "DISABLED", "LOCKED", "REJECTED", "INVITED"]).optional(),
  role: z.enum(["EMPLOYEE", "MANAGER", "HR", "ADMIN", "OWNER"]).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type AccessQuery = z.infer<typeof accessQuerySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
