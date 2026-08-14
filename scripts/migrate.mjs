/**
 * SQL migration runner.
 *
 * Reads `migrations/*.sql`, applies whatever has not been applied yet, and
 * records each success in `schema_migrations`.
 *
 *   node scripts/migrate.mjs           apply pending migrations
 *   node scripts/migrate.mjs status    list applied and pending, change nothing
 *
 * ─── Guarantees ─────────────────────────────────────────────────────────────
 * · Forward-only. There is no down migration and no rollback command; a
 *   mistake is corrected by writing the next migration.
 * · Each migration runs inside its own transaction, together with the INSERT
 *   that records it. A failure rolls back both, so a migration is never marked
 *   applied unless it actually succeeded, and never half-applied.
 * · Execution stops at the first failure. Continuing would apply later
 *   migrations against a schema their author never anticipated.
 * · Re-running is a no-op. Applied versions are skipped by name.
 *
 * ─── Checksums ──────────────────────────────────────────────────────────────
 * The SHA-256 of each file is recorded. If a file changes after being applied,
 * the runner refuses to continue rather than silently ignoring the edit —
 * editing an applied migration means two databases can disagree while both
 * claim to be up to date.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Reduce a migration to the form its checksum is taken over: CRLF and CR
 * collapsed to LF, trailing whitespace at end of file removed. Two checkouts
 * of the same commit on different platforms must produce the same hash.
 */
function normaliseForChecksum(sql) {
  return sql.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
}
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

/** Load DATABASE_URL from .env / .env.local without pulling in dotenv. */
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    try {
      const contents = readFileSync(path.join(ROOT, file), "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        process.env[key] ??= value;
      }
    } catch {
      // Absent file is fine; the variable may come from the environment.
    }
  }
}

loadEnvFiles();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    [
      "",
      "✖ DATABASE_URL is not set.",
      "",
      "  Set it in .env.local (or .env), for example:",
      "    DATABASE_URL=postgresql://user:password@localhost:5432/taskflow_hr",
      "",
      "  See README.md for PostgreSQL setup.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/** `001_initial_schema.sql` → { version: "001", name: "initial_schema" } */
function readMigrations() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch {
    console.error(`✖ No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const files = entries.filter((file) => file.endsWith(".sql")).sort();

  return files.map((file) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(file);
    if (!match) {
      console.error(
        `✖ "${file}" does not match the required NNN_description.sql naming convention.`,
      );
      process.exit(1);
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    return {
      file,
      version: match[1],
      name: match[2],
      sql,
      // Hash the CONTENT, not the bytes. Git rewrites LF to CRLF on checkout
      // under core.autocrlf, so hashing raw bytes makes every migration look
      // modified on a Windows clone — a false alarm that trains people to
      // ignore the one warning that matters. Normalising line endings and the
      // trailing newline leaves the check sensitive to what it is actually
      // guarding: a changed statement.
      checksum: createHash("sha256").update(normaliseForChecksum(sql)).digest("hex"),
    };
  });
}

async function ensureTrackingTable(client) {
  // Created outside the per-migration transactions, because every one of them
  // needs it to already exist.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function main() {
  const command = process.argv[2] ?? "up";
  const migrations = readMigrations();

  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
  } catch (error) {
    console.error(
      [
        "",
        "✖ Could not connect to PostgreSQL.",
        `  ${error.message}`,
        "",
        "  Check that the server is running and DATABASE_URL is correct.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  try {
    await ensureTrackingTable(client);

    const { rows: applied } = await client.query(
      "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version",
    );
    const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

    // Refuse to proceed if an already-applied file has been edited.
    const drifted = migrations.filter((migration) => {
      const record = appliedByVersion.get(migration.version);
      return record && record.checksum !== migration.checksum;
    });

    if (drifted.length > 0) {
      console.error("\n✖ These applied migrations have been modified since they ran:\n");
      for (const migration of drifted) console.error(`    ${migration.file}`);
      console.error(
        [
          "",
          "  Migrations are forward-only. Restore the file to its original",
          "  contents and write a NEW migration for the change you intended.",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }

    if (command === "status") {
      console.log("\nMigration status\n");
      for (const migration of migrations) {
        const record = appliedByVersion.get(migration.version);
        const mark = record ? "applied" : "pending";
        const when = record ? new Date(record.applied_at).toISOString().slice(0, 19).replace("T", " ") : "";
        console.log(`  [${mark.padEnd(7)}] ${migration.file}${when ? `   ${when}` : ""}`);
      }
      const pendingCount = migrations.filter((m) => !appliedByVersion.has(m.version)).length;
      console.log(
        `\n${migrations.length} migration${migrations.length === 1 ? "" : "s"}, ${pendingCount} pending.\n`,
      );
      return;
    }

    const pending = migrations.filter((migration) => !appliedByVersion.has(migration.version));

    if (pending.length === 0) {
      console.log(`\n✔ No pending migrations. Schema is up to date (${migrations.length} applied).\n`);
      return;
    }

    console.log(`\n→ Applying ${pending.length} migration${pending.length === 1 ? "" : "s"}…\n`);

    for (const migration of pending) {
      const startedAt = Date.now();

      try {
        // The migration and the record of it succeed or fail together.
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, duration_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt],
        );
        await client.query("COMMIT");

        console.log(`   ✔ ${migration.file}  (${Date.now() - startedAt} ms)`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);

        console.error(
          [
            "",
            `✖ ${migration.file} failed and was rolled back.`,
            "",
            `  ${error.message}`,
            ...(error.detail ? [`  Detail: ${error.detail}`] : []),
            ...(error.hint ? [`  Hint:   ${error.hint}`] : []),
            ...(error.position ? [`  At character ${error.position}`] : []),
            "",
            "  No later migrations were attempted. The database is unchanged by",
            "  this migration; earlier ones remain applied.",
            "",
          ].join("\n"),
        );
        process.exit(1);
      }
    }

    console.log(`\n✔ Applied ${pending.length} migration${pending.length === 1 ? "" : "s"}.\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\n✖ Migration runner failed:\n", error);
  process.exit(1);
});
