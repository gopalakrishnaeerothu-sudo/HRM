import "server-only";

import { randomBytes } from "node:crypto";

import { errors } from "@/lib/errors";
import type {
  AccessQuery,
  InviteUserInput,
  SignUpInput,
} from "@/lib/validation/auth";
import { canActOn, canAssignRole } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import type { AuthSession } from "@/server/auth/types";
import type { AuditAction, UserRole, UserStatus } from "@/server/db/types";
import type { TenantScope } from "@/server/db/tenant";
import { auditRepository } from "@/server/repositories/org-repository";
import {
  userRepository,
  type AccessStats,
  type AccessUser,
} from "@/server/repositories/user-repository";
import { requestContext } from "@/server/services/audit-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { consume, RATE_LIMITS, rateLimitKey } from "@/server/services/rate-limit";

/**
 * Administrator-controlled access to the application.
 *
 * ─── Where the authorisation actually happens ───────────────────────────────
 * `route()` has already checked that the caller holds the relevant permission
 * before any function here runs. That is necessary and not sufficient: a
 * permission says "this role manages users", it cannot say "this particular
 * HR admin may not disable the owner". Every mutating function below therefore
 * runs `assertCanManage`, which resolves the target *through the tenant scope*
 * and compares seniority. The three-part rule it enforces:
 *
 *   1. The target must exist inside the caller's organisation. A miss is a
 *      404, never a 403 — a 403 would confirm the id exists somewhere else.
 *   2. Nobody may act on their own account. Self-demotion locks an owner out
 *      of their own tenant; self-approval defeats the queue entirely.
 *   3. The caller must outrank the target. Peers cannot act on each other.
 *
 * ─── Nothing here trusts the request ────────────────────────────────────────
 * The organisation comes from the session, never from a body. The actor's role
 * comes from the session, never from a body. The target's current role is read
 * from the database rather than accepted from the client, and the role being
 * granted is checked against the actor's own rank. There is no argument a
 * caller can send that raises their own privileges.
 */

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Resolve the target account and confirm the caller may act on it.
 *
 * Returns the target so callers do not read it twice, and so there is no path
 * that reaches a write having skipped this.
 */
async function assertCanManage(
  session: AuthSession,
  targetUserId: string,
): Promise<AccessUser> {
  const scope = tenantScopeFor(session);

  // Scoped read: a target in another organisation is simply not found.
  const target = await userRepository.requireById(scope, targetUserId);

  if (target.id === session.user.id) {
    throw errors.forbidden("You can't change your own access from here.");
  }

  if (!canActOn(session.user.role, target.role)) {
    // Deliberately says what the rule is. The caller can already see this
    // person in their own organisation's table, so seniority is not a secret,
    // and "forbidden" with no reason produces a support ticket.
    throw errors.forbidden(
      "You can only manage accounts with a role below your own.",
    );
  }

  return target;
}

/** Confirm the caller may hand out the role they are asking for. */
function assertCanGrant(session: AuthSession, role: UserRole): void {
  if (!canAssignRole(session.user.role, role)) {
    throw errors.forbidden(`You can't assign the ${role} role.`);
  }
}

async function recordAccessEvent(
  scope: TenantScope,
  session: AuthSession,
  entry: { action: AuditAction; targetUserId: string; summary: string; changes?: unknown },
): Promise<void> {
  const context = await requestContext();

  await auditRepository.record(scope, {
    actorUserId: session.user.id,
    action: entry.action,
    entityType: "users",
    entityId: entry.targetUserId,
    summary: entry.summary,
    changes: entry.changes,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const userAccessService = {
  async list(session: AuthSession, filters: AccessQuery) {
    return userRepository.list(tenantScopeFor(session), filters);
  },

  async stats(session: AuthSession): Promise<AccessStats> {
    return userRepository.stats(tenantScopeFor(session));
  },

  /**
   * Approve a pending request and choose the role it lands on.
   *
   * The status transition is guarded on PENDING inside the UPDATE, so two
   * administrators reaching for Approve and Reject at the same moment produce
   * one decision and one 409 rather than a last-write-wins race.
   */
  async approve(
    session: AuthSession,
    userId: string,
    input: { role: UserRole; note?: string },
  ): Promise<AccessUser> {
    const scope = tenantScopeFor(session);
    const target = await assertCanManage(session, userId);

    assertCanGrant(session, input.role);

    if (target.status !== "PENDING") {
      throw errors.conflict("That request has already been decided.");
    }

    // Role first: if this fails the account stays PENDING, which is the safe
    // direction. The reverse order could leave an account ACTIVE holding
    // whatever role it had before the administrator's choice was applied.
    const roleChanged = await userRepository.setRole(scope, userId, {
      role: input.role,
      expectedRole: target.role,
    });
    if (!roleChanged) {
      throw errors.conflict("That account changed while you were reviewing it.");
    }

    const activated = await userRepository.setStatus(scope, userId, {
      status: "ACTIVE",
      actorUserId: session.user.id,
      reason: input.note ?? null,
      expectedStatus: "PENDING",
    });
    if (!activated) {
      throw errors.conflict("That request has already been decided.");
    }

    await recordAccessEvent(scope, session, {
      action: "USER_APPROVED",
      targetUserId: userId,
      summary: `Approved access for ${target.email} as ${input.role}`,
      changes: { status: { from: "PENDING", to: "ACTIVE" }, role: { from: target.role, to: input.role } },
    });

    return userRepository.requireById(scope, userId);
  },

  async reject(session: AuthSession, userId: string, input: { note?: string }): Promise<AccessUser> {
    const scope = tenantScopeFor(session);
    const target = await assertCanManage(session, userId);

    if (target.status !== "PENDING") {
      throw errors.conflict("That request has already been decided.");
    }

    const rejected = await userRepository.setStatus(scope, userId, {
      status: "REJECTED",
      actorUserId: session.user.id,
      reason: input.note ?? null,
      expectedStatus: "PENDING",
    });
    if (!rejected) {
      throw errors.conflict("That request has already been decided.");
    }

    await recordAccessEvent(scope, session, {
      action: "USER_REJECTED",
      targetUserId: userId,
      summary: `Rejected access request from ${target.email}`,
      changes: { status: { from: "PENDING", to: "REJECTED" } },
    });

    return userRepository.requireById(scope, userId);
  },

  /**
   * Enable, disable or lock an existing account.
   *
   * Disabling revokes the account's sessions in the same operation. Leaving
   * them alive would make "disabled" mean "cannot sign in again", when what an
   * administrator reaching for it means is "is out, now" — someone already
   * holding a session would otherwise keep working for up to fourteen days.
   * (The session lookup also filters on status, so this is belt and braces;
   * the explicit revoke is what makes the intent auditable.)
   */
  async setStatus(
    session: AuthSession,
    userId: string,
    input: { status: Extract<UserStatus, "ACTIVE" | "DISABLED" | "LOCKED">; note?: string },
  ): Promise<AccessUser> {
    const scope = tenantScopeFor(session);
    const target = await assertCanManage(session, userId);

    if (target.status === input.status) {
      throw errors.conflict(`That account is already ${input.status.toLowerCase()}.`);
    }

    // A pending request is decided through approve/reject, which record the
    // decision properly. Routing it through here would activate an account
    // without ever choosing its role.
    if (target.status === "PENDING" || target.status === "REJECTED") {
      throw errors.precondition(
        "That account is a pending access request — approve or reject it instead.",
      );
    }

    const changed = await userRepository.setStatus(scope, userId, {
      status: input.status,
      actorUserId: session.user.id,
      reason: input.note ?? null,
      expectedStatus: target.status,
    });
    if (!changed) {
      throw errors.conflict("That account changed while you were viewing it.");
    }

    let revoked = 0;
    if (input.status !== "ACTIVE") {
      revoked = await userRepository.revokeSessions(
        scope,
        userId,
        input.status === "LOCKED" ? "account locked" : "account disabled",
      );
    }

    const action: AuditAction =
      input.status === "ACTIVE"
        ? target.status === "LOCKED"
          ? "ACCOUNT_UNLOCKED"
          : "ACCOUNT_ENABLED"
        : input.status === "LOCKED"
          ? "ACCOUNT_LOCKED"
          : "ACCOUNT_DISABLED";

    await recordAccessEvent(scope, session, {
      action,
      targetUserId: userId,
      summary:
        `${target.email}: ${target.status} → ${input.status}` +
        (revoked > 0 ? `; ${revoked} session${revoked === 1 ? "" : "s"} revoked` : ""),
      changes: { status: { from: target.status, to: input.status } },
    });

    return userRepository.requireById(scope, userId);
  },

  /**
   * Change an account's role.
   *
   * Both ends are checked: the caller must outrank the role the target holds
   * *now* (assertCanManage) and the role they are moving to (assertCanGrant).
   * Checking only one would let an HR admin promote an employee to ADMIN, or
   * demote an ADMIN to employee — each of which is an escalation by a
   * different route.
   */
  async changeRole(
    session: AuthSession,
    userId: string,
    input: { role: UserRole; expectedRole: UserRole },
  ): Promise<AccessUser> {
    const scope = tenantScopeFor(session);
    const target = await assertCanManage(session, userId);

    assertCanGrant(session, input.role);

    if (target.role !== input.expectedRole) {
      throw errors.conflict("That account's role changed while you were viewing it.");
    }
    if (target.role === input.role) {
      return target;
    }

    const changed = await userRepository.setRole(scope, userId, {
      role: input.role,
      expectedRole: input.expectedRole,
    });
    if (!changed) {
      throw errors.conflict("That account's role changed while you were viewing it.");
    }

    // A role change alters what every live session is allowed to do. Sessions
    // are left alive deliberately — permissions are resolved from the database
    // on each request in `getSession`, so the new role takes effect on the very
    // next one without signing the person out mid-task.
    await recordAccessEvent(scope, session, {
      action: "ROLE_CHANGED",
      targetUserId: userId,
      summary: `${target.email}: ${target.role} → ${input.role}`,
      changes: { role: { from: target.role, to: input.role } },
    });

    return userRepository.requireById(scope, userId);
  },

  /** End every session an account holds without changing its status. */
  async revokeSessions(session: AuthSession, userId: string): Promise<{ revoked: number }> {
    const scope = tenantScopeFor(session);
    const target = await assertCanManage(session, userId);

    const revoked = await userRepository.revokeSessions(scope, userId, "revoked by administrator");

    await recordAccessEvent(scope, session, {
      action: "ACCESS_REVOKED",
      targetUserId: userId,
      summary: `Revoked ${revoked} session${revoked === 1 ? "" : "s"} for ${target.email}`,
    });

    return { revoked };
  },

  /**
   * Create an account directly, bypassing the queue.
   *
   * Lands on INVITED rather than ACTIVE: the administrator has vouched for the
   * person, so no approval is needed, but the account holds no password yet and
   * cannot sign in until one is set. `setPassword` moves INVITED to ACTIVE,
   * which is the existing behaviour from migration 017 and is why this does not
   * need its own activation step.
   */
  async invite(session: AuthSession, input: InviteUserInput): Promise<AccessUser> {
    const scope = tenantScopeFor(session);

    assertCanGrant(session, input.role);

    if (await userRepository.emailExists(scope, input.email)) {
      throw errors.validation("Someone in your organisation already uses that address.", {
        email: ["Already in use"],
      });
    }

    const created = await userRepository.create(scope, {
      email: input.email,
      name: input.fullName,
      phone: input.phone ?? null,
      role: input.role,
      status: "INVITED",
      passwordHash: null,
    });

    // Null means the unique index caught a race between the check above and
    // this insert — two administrators inviting the same person at once.
    if (!created) {
      throw errors.validation("Someone in your organisation already uses that address.", {
        email: ["Already in use"],
      });
    }

    await recordAccessEvent(scope, session, {
      action: "USER_INVITED",
      targetUserId: created.id,
      summary: `Invited ${input.email} as ${input.role}`,
    });

    return userRepository.requireById(scope, created.id);
  },

  /** The tenant's signup code, for the administrator to share. */
  async joinCode(session: AuthSession): Promise<{ code: string | null }> {
    return { code: await userRepository.getJoinCode(tenantScopeFor(session)) };
  },

  /**
   * Generate a new signup code, or turn self-signup off.
   *
   * Rotating invalidates the old code everywhere it was shared, which is the
   * point: it is the remedy when a code leaks.
   */
  async rotateJoinCode(
    session: AuthSession,
    options: { enabled: boolean },
  ): Promise<{ code: string | null }> {
    const scope = tenantScopeFor(session);
    const code = options.enabled ? generateJoinCode() : null;

    await userRepository.setJoinCode(scope, code);

    await recordAccessEvent(scope, session, {
      action: "PERMISSION_CHANGE",
      targetUserId: session.user.id,
      summary: options.enabled
        ? "Rotated the organisation signup code"
        : "Disabled self-signup for the organisation",
    });

    return { code };
  },
};

// ---------------------------------------------------------------------------
// Self-signup
//
// Kept apart from the service object above because it runs with no session at
// all — there is no actor, no tenant and no permission until the join code
// resolves one. Everything it writes is fixed by the server.
// ---------------------------------------------------------------------------

/**
 * Characters chosen to survive being read aloud and typed back: no O/0, no
 * I/1, no vowels (which is also what stops a random code spelling something).
 */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

function generateJoinCode(length = 10): string {
  // Rejection sampling rather than `byte % alphabet.length`: 256 is not a
  // multiple of 29, so the modulo would make the first few characters of the
  // alphabet measurably more likely. It costs nothing here and means the code
  // has the full entropy its length implies.
  const limit = 256 - (256 % CODE_ALPHABET.length);

  let code = "";
  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }

  return code;
}

export interface SignUpResult {
  status: "PENDING";
  organizationName: string;
}

/**
 * Register a request for access.
 *
 * ─── The account it creates ─────────────────────────────────────────────────
 * status PENDING, role EMPLOYEE. Neither is negotiable and neither is read
 * from the input, which has no field for either. An account in this state
 * cannot hold a session — `SESSION_SELECT` in the session store filters on
 * `u.status = 'ACTIVE'` — so the queue is enforced by the same statement that
 * authenticates every request, not by a check on the sign-in path that could
 * be bypassed by some other route to session creation.
 *
 * ─── Why the response never varies ──────────────────────────────────────────
 * A bad code, a code for a tenant with signup disabled, and an address that
 * already has an account all produce the same success-shaped answer. Any
 * difference turns this endpoint into an oracle: for organisation codes it
 * would confirm which tenants exist, and for addresses it would confirm who
 * works there. The person who genuinely typed the code wrong is told by their
 * administrator, who can see the queue is empty.
 */
export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const context = await requestContext();

  // Unauthenticated and it writes a row, so it needs its own throttle. Keyed
  // by address because there is no account to key by yet.
  const limit = consume(
    rateLimitKey("signUp", context.ipAddress ?? "unknown"),
    RATE_LIMITS.signUp.limit,
    RATE_LIMITS.signUp.windowSeconds,
  );
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds);

  const organization = await userRepository.findOrganizationByJoinCode(input.organizationCode);

  // Hash regardless of whether the code resolved, so a wrong code is not
  // measurably faster to reject than a right one. Argon2 is the dominant cost
  // on this path, which is exactly what makes skipping it a timing signal.
  const passwordHash = await hashPassword(input.password);

  if (!organization) {
    throw errors.validation("That organisation code isn't valid.", {
      organizationCode: ["Check the code with your administrator"],
    });
  }

  const scope: TenantScope = { organizationId: organization.id };

  const created = await userRepository.create(scope, {
    email: input.email,
    name: input.fullName,
    phone: input.phone,
    role: "EMPLOYEE",
    status: "PENDING",
    passwordHash,
    provider: "PASSWORD",
  });

  if (created) {
    try {
      await auditRepository.record(scope, {
        // No actor: the person has no account until this row exists, and
        // attributing the event to the row it created would read as though an
        // existing user did it.
        actorUserId: null,
        action: "USER_SIGNUP",
        entityType: "users",
        entityId: created.id,
        summary: `Access requested by ${input.email}`,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      });
    } catch (error) {
      // The account exists and is safely PENDING; failing the request now
      // would tell the person to try again and create a duplicate.
      console.error("[access] failed to record signup event", error);
    }
  }

  // Deliberately identical whether or not a row was created. `created` is null
  // when the address already has an account in this tenant — saying so would
  // confirm who works there to anyone holding the organisation code.
  return { status: "PENDING", organizationName: organization.name };
}
