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

export type SignInInput = z.infer<typeof signInSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
