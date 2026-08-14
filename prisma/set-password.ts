/**
 * Set or reset a user's password from the command line.
 *
 * The operational answer to "I'm locked out" until self-service recovery
 * exists. Revokes every live session for that user, because a password reset
 * is usually a response to suspected compromise.
 *
 *   npm run db:set-password -- --email admin@acme.com
 *   npm run db:set-password -- --email admin@acme.com --password "…"
 */

import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { hashPassword, validatePasswordStrength } from "../src/server/auth/password";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]);
  return [0, 5, 10, 15].map((start) => chars.slice(start, start + 5).join("")).join("-");
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();

  if (!email) {
    console.error("\nUsage: npm run db:set-password -- --email user@example.com [--password \"…\"]\n");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, name: true, email: true, organization: { select: { name: true } } },
  });

  if (!user) {
    console.error(`✖ No active account found for ${email}.`);
    process.exitCode = 1;
    return;
  }

  const supplied = arg("password");
  if (supplied) {
    const problem = validatePasswordStrength(supplied, { email, name: user.name });
    if (problem) {
      console.error(`✖ That password was rejected: ${problem}`);
      process.exitCode = 1;
      return;
    }
  }

  const password = supplied ?? generatePassword();
  const passwordHash = await hashPassword(password);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordUpdatedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    },
  });

  // Any session opened with the old password stops working immediately.
  const revoked = await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log(
    [
      "",
      `✔ Password updated for ${user.name} <${user.email}> (${user.organization.name}).`,
      `  ${revoked.count} active ${revoked.count === 1 ? "session" : "sessions"} revoked.`,
      "",
      ...(supplied
        ? []
        : [
            `  New password: ${password}`,
            "  Shown once, stored only as a hash. Share it over a secure channel.",
            "",
          ]),
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error("\n✖ Failed:\n", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
