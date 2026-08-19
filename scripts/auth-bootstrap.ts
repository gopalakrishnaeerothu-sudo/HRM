/**
 * Create the first administrator.
 *
 * A fresh deployment has a schema, possibly seeded demo data, and no way in:
 * every account the seed creates is password-less by design. This is the one
 * controlled door, run by whoever owns the deployment.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@company.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='…' \
 *   npm run auth:bootstrap
 *
 * With no BOOTSTRAP_ADMIN_PASSWORD set it prompts, with the terminal echo
 * turned off. Prefer that over the environment variable on a shared machine:
 * an environment variable is visible in the process list and in shell history.
 *
 * ─── What it will not do ────────────────────────────────────────────────────
 * · No default password. There is nothing to forget to change.
 * · The plaintext is hashed with the same Argon2id module the login path uses
 *   and is never written to the database, the log, or the console.
 * · It refuses to overwrite an existing account. Changing a password is a
 *   different operation with different authorisation, and silently resetting
 *   an administrator's credentials from a shell command is how a bootstrap
 *   utility becomes a backdoor.
 *
 * ─── Afterwards ─────────────────────────────────────────────────────────────
 * Remove BOOTSTRAP_ADMIN_* from the environment. The command stays in the
 * repository — it is needed again for the next environment — but it is inert
 * without those variables and refuses to run twice against the same account.
 */

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { hashPassword } from "../src/server/auth/password";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/server/auth/password";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Load DATABASE_URL from .env / .env.local without pulling in dotenv. */
function loadEnvFiles(): void {
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

function fail(message: string, ...detail: string[]): never {
  console.error(`\n✖ ${message}\n`);
  for (const line of detail) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

/** Read a line with terminal echo suppressed. */
async function promptHidden(question: string): Promise<string> {
  const input = process.stdin;

  if (!input.isTTY) {
    fail(
      "No password supplied and no terminal to prompt on.",
      "Set BOOTSTRAP_ADMIN_PASSWORD, or run this from an interactive shell.",
    );
  }

  const rl = createInterface({ input, output: process.stdout, terminal: true });

  return new Promise<string>((resolve) => {
    // `terminal: true` echoes each keystroke; muting the output stream while
    // the answer is being typed is what keeps the password off the screen and
    // out of the scrollback.
    const asMutable = rl as unknown as { output?: { write(chunk: string): void } };
    const realOutput = asMutable.output;
    let muted = false;

    asMutable.output = {
      write(chunk: string) {
        if (!muted) realOutput?.write(chunk);
      },
    };

    rl.question(question, (answer) => {
      muted = false;
      asMutable.output = realOutput;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });

    muted = true;
  });
}

async function main(): Promise<void> {
  loadEnvFiles();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL is not set.", "Set it in .env.local, or export it for this command.");
  }

  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) {
    fail(
      "BOOTSTRAP_ADMIN_EMAIL is not set.",
      "Example:",
      "  BOOTSTRAP_ADMIN_EMAIL=you@company.com npm run auth:bootstrap",
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(`"${email}" is not a valid email address.`);
  }

  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await promptHidden("Password for the administrator: "));

  if (password.length < PASSWORD_MIN_LENGTH) {
    fail(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    fail(`The password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }

  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Administrator";
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Which tenant? One organisation is the ordinary case, so it is chosen
    // without asking. More than one is ambiguous and must be resolved
    // explicitly rather than guessed.
    const requestedSlug = process.env.BOOTSTRAP_ORG_SLUG?.trim();

    const { rows: organizations } = await client.query<{ id: string; slug: string; name: string }>(
      `SELECT id, slug, name FROM organizations
        WHERE deleted_at IS NULL AND ($1::text IS NULL OR slug = $1::text)
        ORDER BY created_at`,
      [requestedSlug ?? null],
    );

    if (organizations.length === 0) {
      fail(
        requestedSlug
          ? `No organisation with slug "${requestedSlug}".`
          : "No organisation exists yet.",
        "Run `npm run db:seed` first, or create an organisation before bootstrapping.",
      );
    }

    if (organizations.length > 1) {
      fail(
        "More than one organisation exists, so the target is ambiguous.",
        "Re-run with BOOTSTRAP_ORG_SLUG set to one of:",
        ...organizations.map((organization) => `  ${organization.slug}  (${organization.name})`),
      );
    }

    const organization = organizations[0]!;

    // Refuse rather than overwrite. See the note at the top of this file.
    const { rows: existing } = await client.query<{ id: string; has_password: boolean }>(
      `SELECT id, password_hash IS NOT NULL AS has_password
         FROM users
        WHERE organization_id = $1 AND lower(email) = $2 AND deleted_at IS NULL`,
      [organization.id, email],
    );

    if (existing.length > 0 && existing[0]!.has_password) {
      fail(
        `${email} already has a password in ${organization.name}.`,
        "This command will not reset an existing account.",
        "Change the password from the application, or reset it deliberately with a separate task.",
      );
    }

    const passwordHash = await hashPassword(password);

    // Two paths, because a seeded account may already exist for this address
    // without credentials — attaching a password to it is right, while
    // creating a second user with the same email would violate the per-tenant
    // unique index.
    const { rows } = existing.length > 0
      ? await client.query<{ id: string; created: boolean }>(
          `UPDATE users
              SET password_hash = $2,
                  password_updated_at = NOW(),
                  provider = 'PASSWORD',
                  role = 'OWNER',
                  status = 'ACTIVE',
                  failed_login_attempts = 0,
                  locked_until = NULL
            WHERE id = $1
          RETURNING id, FALSE AS created`,
          [existing[0]!.id, passwordHash],
        )
      : await client.query<{ id: string; created: boolean }>(
          `INSERT INTO users (
             organization_id, email, name, role, status, provider,
             email_verified, password_hash, password_updated_at
           )
           VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', 'PASSWORD', NOW(), $4, NOW())
           RETURNING id, TRUE AS created`,
          [organization.id, email, name, passwordHash],
        );

    const user = rows[0]!;

    await client.query(
      // entity_id is TEXT while actor_user_id is UUID, so the same id cannot
      // be bound to one parameter for both.
      `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, summary)
       VALUES ($1, $2::uuid, 'PERMISSION_CHANGE', 'users', $3::text, $4)`,
      [
        organization.id,
        user.id,
        user.id,
        user.created
          ? "Bootstrap: created the initial administrator account"
          : "Bootstrap: attached administrator credentials to an existing account",
      ],
    );

    await client.query("COMMIT");

    console.log("\n✔ Administrator ready.\n");
    console.log(`   Organisation : ${organization.name}`);
    console.log(`   Email        : ${email}`);
    console.log(`   Role         : OWNER`);
    console.log(`   Account      : ${user.created ? "created" : "existing account, credentials attached"}`);
    console.log("\n   Sign in at /login with the password you supplied.");
    console.log("   Unset BOOTSTRAP_ADMIN_PASSWORD now — it is no longer needed.\n");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Never let a driver error print the parameters it was called with.
  console.error("\n✖ Bootstrap failed:", error instanceof Error ? error.message : error, "\n");
  process.exit(1);
});
