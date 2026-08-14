import { Pool } from "pg";

/**
 * Test access to a SQL-migrated database.
 *
 * Separate from `helpers/db.ts`, which talks to the Prisma-shaped schema. The
 * two schemas differ (snake_case versus camelCase columns), so they cannot
 * share a database while the port is in progress.
 *
 * Point SQL_TEST_DATABASE_URL at a THROWAWAY database and migrate it first:
 *
 *   node scripts/create-test-db.mjs                      (TEST_DATABASE_NAME=hrm_sql_test)
 *   DATABASE_URL=…/hrm_sql_test node scripts/migrate.mjs
 */

export const SQL_TEST_DATABASE_URL = process.env.SQL_TEST_DATABASE_URL;

/** True when these tests can run. Use with `describe.skipIf`. */
export const hasSqlTestDatabase = Boolean(SQL_TEST_DATABASE_URL);

let pool: Pool | null = null;

export function sqlTestPool(): Pool {
  if (!SQL_TEST_DATABASE_URL) {
    throw new Error("SQL_TEST_DATABASE_URL is not set — this suite should have been skipped.");
  }
  pool ??= new Pool({ connectionString: SQL_TEST_DATABASE_URL, max: 4 });
  return pool;
}

export async function disconnectSqlTestDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

/**
 * Empty every table.
 *
 * TRUNCATE … CASCADE in one statement, which is both far faster than ordered
 * DELETEs and immune to the foreign-key ordering problem. `schema_migrations`
 * is deliberately excluded: wiping it would make the runner try to re-apply
 * everything against a schema that already exists.
 */
export async function resetSqlDatabase(): Promise<void> {
  const client = await sqlTestPool().connect();

  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
    );

    if (rows.length === 0) {
      throw new Error(
        "The SQL test database has no tables. Run scripts/migrate.mjs against it first.",
      );
    }

    const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
    await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    client.release();
  }
}

/** Insert an organisation and return its id. */
export async function createSqlTenant(slug: string, name: string): Promise<string> {
  const { rows } = await sqlTestPool().query<{ id: string }>(
    `INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id`,
    [slug, name],
  );
  return rows[0]!.id;
}
