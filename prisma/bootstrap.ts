/**
 * Production bootstrap.
 *
 * Creates the minimum a real deployment needs to be usable: one organisation,
 * one administrator who can sign in, the permission catalogue, and a first
 * office. Nothing else.
 *
 * This is emphatically NOT `prisma/seed.ts`. That script deletes every row and
 * creates 22 accounts sharing a publicly-known password; running it against a
 * production database would be a catastrophe. This one:
 *
 *   · never deletes anything
 *   · is idempotent — running it twice changes nothing the second time
 *   · creates no fake employees, tasks or attendance history
 *   · generates a random admin password and prints it exactly once
 *
 * Usage:
 *   npm run db:bootstrap -- --org "Acme Technologies" --email admin@acme.com
 *
 * Optional:
 *   --name "Ada Lovelace"      administrator's display name
 *   --password "…"             supply your own instead of generating one
 *   --timezone "Asia/Kolkata"
 *   --office "Head Office"     also create a first office
 *   --lat 16.30656 --lng 80.4365 --radius 100
 */

import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { hashPassword, validatePasswordStrength } from "../src/server/auth/password";
import { PERMISSIONS } from "../src/server/auth/permissions";

const prisma = new PrismaClient();

// --- Argument parsing -------------------------------------------------------

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/** Readable, high-entropy password: 4 groups of 5 base32-ish characters. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return [
    chars.slice(0, 5).join(""),
    chars.slice(5, 10).join(""),
    chars.slice(10, 15).join(""),
    chars.slice(15, 20).join(""),
  ].join("-");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function main(): Promise<void> {
  const orgName = arg("org");
  const email = arg("email")?.trim().toLowerCase();

  if (!orgName || !email) {
    console.error(
      [
        "",
        "Usage: npm run db:bootstrap -- --org \"Acme Technologies\" --email admin@acme.com",
        "",
        "Required:",
        "  --org      organisation name",
        "  --email    administrator's email address",
        "",
        "Optional:",
        "  --name, --password, --timezone, --office, --lat, --lng, --radius",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`✖ "${email}" is not a valid email address.`);
    process.exitCode = 1;
    return;
  }

  const adminName = arg("name") ?? "Administrator";
  const timezone = arg("timezone") ?? "Asia/Kolkata";

  // Supplied password must clear the same policy the app enforces.
  const supplied = arg("password");
  if (supplied) {
    const problem = validatePasswordStrength(supplied, { email, name: adminName });
    if (problem) {
      console.error(`✖ That password was rejected: ${problem}`);
      process.exitCode = 1;
      return;
    }
  }
  const password = supplied ?? generatePassword();

  // --- Permission catalogue (idempotent) ------------------------------------
  await prisma.permission.createMany({
    data: PERMISSIONS.map((key) => ({
      key,
      label: key.split(":").join(" — "),
      category: key.split(":")[0] ?? "general",
    })),
    skipDuplicates: true,
  });

  // --- Organisation ---------------------------------------------------------
  const slug = slugify(orgName);

  const existingOrg = await prisma.organization.findUnique({ where: { slug } });
  if (existingOrg) {
    console.log(`· Organisation "${orgName}" already exists — leaving it untouched.`);
  }

  const organization =
    existingOrg ??
    (await prisma.organization.create({
      data: { name: orgName, slug, timezone, plan: "GROWTH" },
    }));

  // --- Administrator --------------------------------------------------------
  const existingUser = await prisma.user.findFirst({
    where: { organizationId: organization.id, email },
  });

  if (existingUser) {
    // Never silently reset a live administrator's password.
    console.log(
      [
        "",
        `· An account for ${email} already exists in "${orgName}".`,
        "  Bootstrap made no changes to it. To reset its password, use:",
        "    npm run db:set-password -- --email " + email,
        "",
      ].join("\n"),
    );
    return;
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email,
      name: adminName,
      role: "OWNER",
      status: "ACTIVE",
      provider: "PASSWORD",
      emailVerified: new Date(),
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
  });

  // An employee record, so the administrator has a full identity rather than a
  // user account with no profile.
  await prisma.employee.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      employeeCode: "ADMIN-0001",
      firstName: adminName.split(" ")[0] ?? adminName,
      lastName: adminName.split(" ").slice(1).join(" ") || "—",
      email,
      designation: "Administrator",
      joinedAt: new Date(),
      status: "ACTIVE",
    },
  });

  // --- Optional first office -------------------------------------------------
  const officeName = arg("office");
  if (officeName) {
    const latitude = Number(arg("lat"));
    const longitude = Number(arg("lng"));
    const radiusMeters = Number(arg("radius") ?? 100);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn("· --office given without valid --lat/--lng; skipping office creation.");
    } else {
      await prisma.office.create({
        data: {
          organizationId: organization.id,
          name: officeName,
          code: "HQ",
          addressLine: "—",
          city: "—",
          timezone,
          latitude,
          longitude,
          geofences: {
            create: {
              name: "Main perimeter",
              latitude,
              longitude,
              radiusMeters: Number.isFinite(radiusMeters) ? radiusMeters : 100,
              isPrimary: true,
            },
          },
        },
      });
      console.log(`· Created office "${officeName}" with a ${radiusMeters} m perimeter.`);
    }
  }

  // --- Report ---------------------------------------------------------------
  console.log(
    [
      "",
      "✔ Bootstrap complete.",
      "",
      `   Organisation : ${organization.name}`,
      `   Workspace    : ${organization.slug}`,
      `   Administrator: ${email}`,
      "",
      ...(supplied
        ? ["   Password     : (the one you supplied)"]
        : [
            "   ┌──────────────────────────────────────────────────────┐",
            `   │  Password: ${password.padEnd(41)}│`,
            "   └──────────────────────────────────────────────────────┘",
            "",
            "   This is shown ONCE and is not stored anywhere in plaintext.",
            "   Save it now, then change it after signing in.",
          ]),
      "",
      "   Next: sign in at /login",
      "",
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error("\n✖ Bootstrap failed:\n", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
