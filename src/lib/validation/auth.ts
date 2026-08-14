import { z } from "zod";

import { emailSchema } from "@/lib/validation/common";

/**
 * Authentication input.
 *
 * The login schema deliberately does NOT apply the password strength rules —
 * those belong on the *set password* path. Rejecting a weak password at login
 * would tell an attacker their guess failed a policy check rather than a
 * comparison, and would lock out anyone whose password predates a policy change.
 */
export const loginSchema = z.object({
  email: emailSchema,
  // Bounded only, so a huge body cannot be used to burn hashing CPU.
  password: z.string().min(1, "Enter your password").max(200),
  /** Where to go after signing in. Validated as a local path in the handler. */
  redirectTo: z.string().max(512).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(200),
    newPassword: z.string().min(1, "Enter a new password").max(200),
    confirmPassword: z.string().min(1, "Confirm your new password").max(200),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "The two passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Choose a password you haven't used here before",
    path: ["newPassword"],
  });

/**
 * Only same-origin, absolute-path redirects are allowed.
 *
 * Without this, `?redirectTo=https://evil.example` turns the login page into
 * an open redirect: a convincing phishing link that genuinely starts on your
 * domain. Protocol-relative `//evil.example` is the case people forget, so it
 * is rejected explicitly.
 */
export function safeRedirect(target: string | undefined | null, fallback = "/app"): string {
  if (!target) return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//")) return fallback;
  if (target.includes("\\")) return fallback;
  // Never bounce back to an auth route; that would loop.
  if (target.startsWith("/login") || target.startsWith("/api/")) return fallback;
  return target;
}
