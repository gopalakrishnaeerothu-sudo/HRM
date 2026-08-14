/**
 * Create the throwaway database used by the integration tests.
 *
 * `CREATE DATABASE` cannot run inside a transaction, so it goes through
 * `$executeRawUnsafe` on a connection to the default database. Safe to re-run —
 * an existing database is reported and ignored.
 */
import { PrismaClient } from "@prisma/client";

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/postgres";
const NAME = process.env.TEST_DATABASE_NAME ?? "taskflow_test";

const db = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });

try {
  await db.$executeRawUnsafe(`CREATE DATABASE "${NAME}"`);
  console.log(`✔ Created database "${NAME}"`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("already exists")) {
    console.log(`· Database "${NAME}" already exists`);
  } else {
    console.error("✖ Could not create the test database:\n", message);
    process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
