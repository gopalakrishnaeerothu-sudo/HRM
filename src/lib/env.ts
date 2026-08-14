import { z } from "zod";

/**
 * Boot-time environment validation.
 *
 * Two separate schemas enforce the server/client boundary:
 *  - `serverSchema` may only be read from server code. Importing `env` into a
 *    Client Component is a build error, because Next cannot inline these.
 *  - `clientSchema` covers `NEXT_PUBLIC_*` values, which are inlined into the
 *    browser bundle and must therefore never hold a secret.
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_X` at build time only for literal
 * property accesses, so the client values below are spelled out in full rather
 * than looked up dynamically.
 */

const nodeEnv = z.enum(["development", "production", "test"]);

const serverSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),
  NODE_ENV: nodeEnv.default("development"),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 32`"),
  STORAGE_URL: z.string().url().optional(),
  DEV_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEV_AUTH_DEFAULT_USER: z.string().email().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be an absolute URL"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("TaskFlow HR"),
  NEXT_PUBLIC_APP_TAGLINE: z
    .string()
    .min(1)
    .default("One workspace for your people, tasks and attendance."),
});

function format(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`);
  return `Invalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example for the full list.`;
}

const clientParsed = clientSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || undefined,
  NEXT_PUBLIC_APP_TAGLINE: process.env.NEXT_PUBLIC_APP_TAGLINE || undefined,
});

if (!clientParsed.success) {
  throw new Error(format(clientParsed.error));
}

/** Safe to read from anywhere, including the browser. Contains no secrets. */
export const clientEnv = clientParsed.data;

let cachedServerEnv: z.infer<typeof serverSchema> | null = null;

/**
 * Server-only configuration. Throws if called from the browser so a secret can
 * never leak through an accidental client import.
 */
export function serverEnv(): z.infer<typeof serverSchema> {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser — server secrets must stay on the server.");
  }
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    STORAGE_URL: process.env.STORAGE_URL || undefined,
    DEV_AUTH_ENABLED: process.env.DEV_AUTH_ENABLED,
    DEV_AUTH_DEFAULT_USER: process.env.DEV_AUTH_DEFAULT_USER || undefined,
  });

  if (!parsed.success) {
    throw new Error(format(parsed.error));
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export const isProduction = process.env.NODE_ENV === "production";
export const isTest = process.env.NODE_ENV === "test";
