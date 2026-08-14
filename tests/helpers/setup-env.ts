/**
 * Test environment bootstrap. Runs before any test module is imported.
 *
 * Repository and service functions use the shared client from `@/lib/db`,
 * which reads `DATABASE_URL` at import time. Integration tests must not touch
 * the development database, so `DATABASE_URL` is *replaced* here with
 * `TEST_DATABASE_URL` before that module is ever loaded.
 *
 * That ordering is the whole point of this file: setting it inside a test
 * would be too late, because the client would already be constructed against
 * the development URL — and `resetDatabase()` truncates every table.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Vitest does not load `.env`, so TEST_DATABASE_URL is read from it here when
 * it is not already in the environment. Parsed by hand rather than pulling in
 * dotenv: it is a handful of `KEY="value"` lines and this runs before anything
 * else in the process.
 */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");

    // Never override something explicitly set on the command line.
    process.env[key] ??= value;
  }
}

loadDotEnv();

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl) {
  process.env.DATABASE_URL = testUrl;
} else {
  // No test database configured: point the client at something obviously
  // invalid so that a suite which forgot to skip fails loudly rather than
  // silently connecting to a real database.
  process.env.DATABASE_URL = "postgresql://unset:unset@127.0.0.1:1/unset";
}

// Env validation requires these; they are irrelevant to the tests themselves.
process.env.AUTH_SECRET ??= "test-secret-value-not-used-for-anything-0000";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.DEV_AUTH_ENABLED ??= "false";

export {};
