import { Pool } from "pg";

/**
 * Test access to a SQL-migrated database.
 *
 * The one database helper. An earlier `helpers/db.ts` talked to a
 * Prisma-shaped schema with camelCase columns; that schema and that helper are
 * both gone.
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

/**
 * A fully-formed tenant: organisation, office with a primary perimeter,
 * department, user and employee.
 *
 * Built with the same statements the application would use, against the one
 * schema the migrations produce.
 */
export async function createSqlTenant2(options: {
  slug: string;
  name: string;
  officeLatitude?: number;
  officeLongitude?: number;
  radiusMeters?: number;
}) {
  const pool = sqlTestPool();
  const latitude = options.officeLatitude ?? 16.30656;
  const longitude = options.officeLongitude ?? 80.4365;

  const { rows: orgRows } = await pool.query<{ id: string }>(
    `INSERT INTO organizations (slug, name, timezone)
     VALUES ($1, $2, 'Asia/Kolkata') RETURNING id`,
    [options.slug, options.name],
  );
  const organization = { id: orgRows[0]!.id };

  // Office and perimeter in one statement: an office with no zone is a site
  // nobody can check in to, which would make the fixture unusable.
  const { rows: officeRows } = await pool.query<{ id: string; geofence_id: string }>(
    `WITH new_office AS (
       INSERT INTO offices (organization_id, name, code, address_line, city,
                            latitude, longitude)
       VALUES ($1, $2, 'HQ', '1 Test Street', 'Guntur', $3, $4)
       RETURNING id
     ), zone AS (
       INSERT INTO office_geofences (office_id, name, latitude, longitude,
                                     radius_meters, is_primary)
       SELECT id, 'Main perimeter', $3, $4, $5, TRUE FROM new_office
       RETURNING id, office_id
     )
     SELECT zone.office_id AS id, zone.id AS geofence_id FROM zone`,
    [organization.id, `${options.name} HQ`, latitude, longitude, options.radiusMeters ?? 100],
  );
  const office = {
    id: officeRows[0]!.id,
    latitude,
    longitude,
    geofences: [{ id: officeRows[0]!.geofence_id }],
  };

  const { rows: deptRows } = await pool.query<{ id: string }>(
    `INSERT INTO departments (organization_id, name, code)
     VALUES ($1, 'Engineering', 'ENG') RETURNING id`,
    [organization.id],
  );
  const department = { id: deptRows[0]!.id };

  const { rows: userRows } = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, role)
     VALUES ($1, $2, 'Test Owner', 'OWNER') RETURNING id`,
    [organization.id, `owner@${options.slug}.example`],
  );
  const user = { id: userRows[0]!.id };

  const { rows: empRows } = await pool.query<{ id: string }>(
    `INSERT INTO employees (organization_id, user_id, employee_code, first_name,
                            last_name, email, designation, department_id,
                            primary_office_id, joined_at)
     VALUES ($1, $2, 'EMP-0001', 'Test', 'Owner', $3, 'Founder', $4, $5,
             '2024-01-01')
     RETURNING id`,
    [organization.id, user.id, `owner@${options.slug}.example`, department.id, office.id],
  );
  const employee = { id: empRows[0]!.id };

  return { organization, office, department, user, employee };
}
