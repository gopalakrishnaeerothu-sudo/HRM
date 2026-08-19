/**
 * Create the throwaway database used by the integration tests.
 *
 * `CREATE DATABASE` cannot run inside a transaction, so it goes out on a plain
 * connection to the maintenance database rather than through the migration
 * runner. Safe to re-run — an existing database is reported and ignored.
 *
 * The name is interpolated rather than parameterised because PostgreSQL does
 * not accept a parameter in that position; it is validated against a strict
 * pattern first, and quoted, so a hostile TEST_DATABASE_NAME cannot break out.
 */
import pg from "pg";

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/postgres";
const NAME = process.env.TEST_DATABASE_NAME ?? "taskflow_test";

if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(NAME)) {
  console.error(
    `✖ "${NAME}" is not a usable database name.\n` +
      "  Use letters, digits and underscores, starting with a letter or underscore.",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: ADMIN_URL });

try {
  await client.connect();
  await client.query(`CREATE DATABASE "${NAME}"`);
  console.log(`✔ Created database "${NAME}"`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  // 42P04 is duplicate_database. Matching the code rather than the message
  // keeps this working under a non-English server locale.
  if (error?.code === "42P04" || message.includes("already exists")) {
    console.log(`· Database "${NAME}" already exists`);
  } else {
    console.error("✖ Could not create the test database:\n", message);
    process.exitCode = 1;
  }
} finally {
  await client.end().catch(() => undefined);
}
