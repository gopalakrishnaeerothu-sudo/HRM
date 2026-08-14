import "server-only";

import { Pool, types } from "pg";

import { isProduction, serverEnv } from "@/lib/env";

/**
 * PostgreSQL connection pool.
 *
 * One pool per process. Next's dev server re-evaluates modules on every hot
 * reload, which would open a new pool each time and exhaust the server's
 * connection slots, so the pool is stashed on `globalThis` in development. In
 * production the module is evaluated once and the global is not used.
 *
 * ─── Type parsing ───────────────────────────────────────────────────────────
 * node-postgres makes two decisions by default that are wrong for this
 * application, and both are corrected below. Left alone they produce bugs that
 * only appear with large numbers or across timezones — the kind that reach
 * production because nobody notices in a small dataset.
 */

// ---------------------------------------------------------------------------
// Type parsers, registered once at module load.
// ---------------------------------------------------------------------------

/**
 * NUMERIC (OID 1700) arrives as a string, because arbitrary precision does not
 * fit in a JavaScript number. Every NUMERIC column in this schema is a small
 * bounded quantity — hours worked, leave days — so parsing to a float is safe
 * and saves every caller a conversion.
 */
types.setTypeParser(1700, (value) => (value === null ? null : Number.parseFloat(value)));

/** INT8 / BIGINT (OID 20) also arrives as a string, for the same reason. The
 *  only BIGINT here is a file size, comfortably inside Number.MAX_SAFE_INTEGER. */
types.setTypeParser(20, (value) => (value === null ? null : Number.parseInt(value, 10)));

/**
 * DATE (OID 1082) is the important one.
 *
 * By default node-postgres parses '2026-08-08' into a Date at LOCAL midnight.
 * On a machine in IST that becomes 2026-08-07T18:30:00Z — the previous day in
 * UTC. Attendance is keyed by date, so that silently shifts every record by a
 * day depending on where the server runs.
 *
 * The application's convention is that a DATE is midnight UTC, so it is parsed
 * that way explicitly.
 */
types.setTypeParser(1082, (value) => (value === null ? null : new Date(`${value}T00:00:00.000Z`)));

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as { pgPool?: Pool };

function createPool(): Pool {
  const pool = new Pool({
    connectionString: serverEnv().DATABASE_URL,
    // Railway's managed Postgres allows a modest number of connections and the
    // app runs as a single instance; 10 leaves headroom for migrations and a
    // psql session.
    max: isProduction ? 10 : 5,
    idleTimeoutMillis: 30_000,
    // Fail fast rather than hanging a request behind an unreachable database.
    connectionTimeoutMillis: 10_000,
  });

  /**
   * An idle client can be terminated by the server or by a network device. The
   * pool emits 'error' for that; without a listener Node treats it as an
   * unhandled 'error' event and kills the process. Logging and continuing is
   * correct — the pool discards the broken client and opens another.
   */
  pool.on("error", (error) => {
    console.error("[db] idle client error", { message: error.message });
  });

  return pool;
}

export const pool: Pool = globalForDb.pgPool ?? createPool();

if (!isProduction) {
  globalForDb.pgPool = pool;
}

/** Close the pool. For scripts and test teardown; the server never calls it. */
export async function closePool(): Promise<void> {
  await pool.end();
  if (!isProduction) delete globalForDb.pgPool;
}
