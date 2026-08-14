import "server-only";

import { prisma } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { Permission } from "@/server/auth/permissions";
import { fakeVerify, hashPassword, needsRehash, verifyPassword } from "@/server/auth/password";
import {
  clearSessionCookie,
  readSessionCookie,
  sessionStore,
  type SessionContext,
} from "@/server/auth/session-store";
import type { AuthAdapter, AuthSession, SignInCredentials } from "@/server/auth/types";

/**
 * Production authentication: email plus password, server-side sessions.
 *
 * This is the adapter the application uses whenever the development adapter is
 * not explicitly enabled. It satisfies the `AuthAdapter` contract, so nothing
 * outside this folder changed when it was introduced.
 *
 * ─── What "authenticated" means here ────────────────────────────────────────
 * A request carries an opaque session token. The token is looked up, the user
 * is re-read from the database on every request, and identity — organisation,
 * employee, role, permission overrides — is derived from those rows. Nothing
 * about the caller is taken from the request body, a header, or a JWT claim,
 * so a stale or forged client cannot assert a role it does not have.
 *
 * ─── Account lockout ────────────────────────────────────────────────────────
 * Five consecutive failures lock the account for fifteen minutes. The lock is
 * per account rather than per IP, because credential stuffing rotates IPs. It
 * is a lockout, not a permanent ban, so it cannot be used to deny a colleague
 * access indefinitely.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Load the full identity graph for a user id.
 *
 * Deliberately re-read on every request rather than cached in the token: a
 * disabled account, a changed role or a deleted employee record must take
 * effect immediately, not at the next login.
 */
async function loadSession(userId: string, strategy: AuthSession["strategy"]): Promise<AuthSession | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      role: true,
      organization: { select: { id: true, slug: true, name: true, timezone: true, deletedAt: true } },
      employee: {
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          designation: true,
          avatarUrl: true,
          departmentId: true,
          managerId: true,
          primaryOfficeId: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  // A user in a soft-deleted organisation has no valid session.
  if (!user || user.organization.deletedAt) return null;

  const overrideRows = await prisma.rolePermission.findMany({
    where: { organizationId: user.organization.id, role: user.role },
    select: { granted: true, permission: { select: { key: true } } },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
    },
    organization: {
      id: user.organization.id,
      slug: user.organization.slug,
      name: user.organization.name,
      timezone: user.organization.timezone,
    },
    // A suspended or soft-deleted employee keeps their user account but loses
    // the employee identity, so employee-scoped actions (check-in, leave)
    // refuse rather than silently acting on a stale record.
    employee:
      user.employee && !user.employee.deletedAt && user.employee.status !== "SUSPENDED"
        ? {
            id: user.employee.id,
            employeeCode: user.employee.employeeCode,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            designation: user.employee.designation,
            avatarUrl: user.employee.avatarUrl,
            departmentId: user.employee.departmentId,
            managerId: user.employee.managerId,
            primaryOfficeId: user.employee.primaryOfficeId,
          }
        : null,
    permissionOverrides: new Map<Permission, boolean>(
      overrideRows.map((row) => [row.permission.key as Permission, row.granted]),
    ),
    strategy,
  };
}

export const productionAuthAdapter: AuthAdapter = {
  name: "password-session",
  strategy: "session-cookie",

  async getSession(): Promise<AuthSession | null> {
    const token = await readSessionCookie();
    if (!token) return null;

    const resolved = await sessionStore.resolve(token);
    if (!resolved) return null;

    const session = await loadSession(resolved.userId, "session-cookie");

    // The session row is valid but the user is gone, disabled, or moved to a
    // deleted organisation: kill the session so it stops being retried.
    if (!session) {
      await sessionStore.revoke(token);
      return null;
    }

    // A session must never outlive its tenant binding. If the row's
    // organisation no longer matches the user's, something is badly wrong.
    if (session.organization.id !== resolved.organizationId) {
      await sessionStore.revoke(token);
      return null;
    }

    return session;
  },

  async signIn(credentials: SignInCredentials) {
    if (credentials.kind !== "password") {
      throw errors.precondition(
        `This deployment authenticates with email and password; "${credentials.kind}" is not configured.`,
      );
    }

    const email = credentials.email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        passwordHash: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        organizationId: true,
        organization: { select: { deletedAt: true } },
      },
    });

    // Unknown account: still burn comparable CPU, then give the same message a
    // wrong password gets. Neither the response nor its timing reveals whether
    // the address is registered.
    if (!user || !user.passwordHash) {
      await fakeVerify();
      throw errors.unauthenticated("That email or password isn't right.");
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw errors.rateLimited(minutes * 60);
    }

    const valid = await verifyPassword(credentials.password, user.passwordHash);

    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });

      throw errors.unauthenticated("That email or password isn't right.");
    }

    // Correct password, but the account may still not be allowed in. Checked
    // *after* verification so that account state is not disclosed to someone
    // who does not hold the password.
    if (user.status !== "ACTIVE" || user.organization.deletedAt) {
      throw errors.forbidden("This account is not active. Contact your administrator.");
    }

    const session = await loadSession(user.id, "session-cookie");
    if (!session) {
      throw errors.forbidden("This account is not active. Contact your administrator.");
    }

    const context: SessionContext = credentials.context ?? {};

    // Rotate against any pre-existing cookie — the session-fixation defence.
    const previousToken = await readSessionCookie();
    const issued = await sessionStore.rotate(previousToken, user.id, user.organizationId, context);

    // Opportunistically upgrade a hash created under weaker parameters, now
    // that we hold the plaintext and know it is correct.
    const rehash = needsRehash(user.passwordHash)
      ? await hashPassword(credentials.password)
      : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(rehash ? { passwordHash: rehash, passwordUpdatedAt: new Date() } : {}),
      },
    });

    return { session, token: issued.token };
  },

  async signOut(): Promise<void> {
    const token = await readSessionCookie();
    if (token) await sessionStore.revoke(token);
    await clearSessionCookie();
  },
};

/**
 * Set or replace a user's password.
 *
 * Every live session for that user is revoked, because a password change is
 * usually a response to suspected compromise — leaving other sessions alive
 * would defeat the point.
 */
export async function setUserPassword(userId: string, plaintext: string): Promise<void> {
  const passwordHash = await hashPassword(plaintext);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordUpdatedAt: new Date(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await sessionStore.revokeAllForUser(userId);
}

export { loadSession as loadAuthSession };
