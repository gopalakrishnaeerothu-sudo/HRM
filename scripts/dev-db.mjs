/**
 * Local PostgreSQL for development, with no Docker and no system install.
 *
 * Runs a real PostgreSQL server from the `embedded-postgres` binaries into
 * `.pgdata/`. This is a convenience for getting started on a fresh machine —
 * production uses Railway's managed Postgres, and nothing in `src/` knows this
 * script exists.
 *
 *   node scripts/dev-db.mjs start    # start (and initialise on first run)
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs reset    # delete the cluster and start fresh
 *
 * The server keeps running after `start` returns, so migrate/seed/dev can use
 * it. Stop it with `node scripts/dev-db.mjs stop`.
 */

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const ROOT = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const DATA_DIR = path.join(ROOT, ".pgdata");

// 5433 by default so this never collides with a system PostgreSQL on 5432.
// Must match DATABASE_URL in .env.
const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const USER = "postgres";
const PASSWORD = "postgres";
const DATABASE = "postgres";

function createServer() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {
      /* PostgreSQL's own logs are noisy; failures still surface as thrown errors. */
    },
  });
}

async function start() {
  const fresh = !existsSync(DATA_DIR);
  const server = createServer();

  if (fresh) {
    console.log("→ Initialising a new PostgreSQL cluster in .pgdata …");
    await server.initialise();
  }

  console.log(`→ Starting PostgreSQL on port ${PORT} …`);
  await server.start();

  // initdb already creates the `postgres` database, so there is nothing to
  // create on a fresh cluster — the app uses that one directly.

  const url = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}?schema=public`;
  console.log("\n✔ PostgreSQL is running.\n");
  console.log(`   DATABASE_URL="${url}"\n`);
  console.log("   Next:  npm run db:migrate && npm run db:seed && npm run dev");
  console.log("   Stop:  node scripts/dev-db.mjs stop\n");
}

async function stop() {
  const server = createServer();
  try {
    await server.stop();
    console.log("✔ PostgreSQL stopped.");
  } catch (error) {
    console.log("· PostgreSQL was not running.");
  }
}

async function reset() {
  await stop();
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    console.log("· Removed .pgdata");
  }
  await start();
}

const command = process.argv[2] ?? "start";

const actions = { start, stop, reset };
const action = actions[command];

if (!action) {
  console.error(`Unknown command "${command}". Use: start | stop | reset`);
  process.exit(1);
}

action().catch((error) => {
  console.error("\n✖ Failed:\n", error);
  process.exit(1);
});
