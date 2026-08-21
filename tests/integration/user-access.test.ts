import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/server/auth/password";
import type { AuthSession } from "@/server/auth/types";
import type { UserRole, UserStatus } from "@/server/db/types";
import type { TenantScope } from "@/server/db/tenant";
import { userRepository } from "@/server/repositories/user-repository";
import { userAccessService, signUp } from "@/server/services/user-access-service";
import { __resetRateLimits } from "@/server/services/rate-limit";
import {
  createSqlTenant2 as createTenant,
  disconnectSqlTestDb as disconnectTestDb,
  hasSqlTestDatabase as hasTestDatabase,
  resetSqlDatabase as resetDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

/**
 * The access lifecycle, end to end against PostgreSQL.
 *
 * These assert the behaviour the feature exists to guarantee, not the shape of
 * the code that implements it: a signup lands in a queue, only an approval
 * gets it out, and no request an employee can make moves them up.
 *
 * Sign-in is exercised through the same predicate the session lookup uses
 * (`users.status = 'ACTIVE'`) rather than through the HTTP adapter, which
 * needs `next/headers` and a request scope that does not exist here. The
 * status transitions are the thing under test; that the session query filters
 * on them is asserted directly.
 *
 * Skipped when SQL_TEST_DATABASE_URL is unset — see tests/helpers/sql-db.ts.
 */
describe.skipIf(!hasTestDatabase)("user access management", () => {
  let acme: Awaited<ReturnType<typeof createTenant>>;
  let globex: Awaited<ReturnType<typeof createTenant>>;
  let acmeScope: TenantScope;
  let globexScope: TenantScope;

  const ACME_CODE = "ACMEJOIN99";
  const GLOBEX_CODE = "GLOBEXJOIN";

  /** A session object of the shape the services consume. */
  function sessionFor(
    organizationId: string,
    user: { id: string; role: UserRole },
  ): AuthSession {
    return {
      user: {
        id: user.id,
        email: "actor@example.test",
        name: "Actor",
        avatarUrl: null,
        role: user.role,
      },
      organization: { id: organizationId, slug: "acme", name: "Acme", timezone: "Asia/Kolkata" },
      employee: null,
      permissionOverrides: new Map(),
      strategy: "session-cookie",
    };
  }

  async function statusOf(userId: string): Promise<UserStatus> {
    const { rows } = await sqlTestPool().query<{ status: UserStatus }>(
      `SELECT status FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]!.status;
  }

  async function roleOf(userId: string): Promise<UserRole> {
    const { rows } = await sqlTestPool().query<{ role: UserRole }>(
      `SELECT role FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]!.role;
  }

  /**
   * Whether this account would resolve a session — the exact predicate from
   * SESSION_SELECT in the session store. This is what "can log in" means.
   */
  async function canHoldSession(userId: string): Promise<boolean> {
    const { rows } = await sqlTestPool().query(
      `SELECT 1
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE u.id = $1
          AND u.deleted_at IS NULL
          AND u.status = 'ACTIVE'
          AND o.deleted_at IS NULL`,
      [userId],
    );
    return rows.length === 1;
  }

  /** Put a signup through the public entry point. */
  async function requestAccess(
    email: string,
    code = ACME_CODE,
  ): Promise<{ id: string; status: UserStatus }> {
    await signUp({
      fullName: "Rahul Verma",
      email,
      phone: "+91 98765 43210",
      organizationCode: code,
      password: "correct-horse-battery-staple",
      confirmPassword: "correct-horse-battery-staple",
    });

    const { rows } = await sqlTestPool().query<{ id: string; status: UserStatus }>(
      `SELECT id, status FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    await resetDatabase();

    acme = await createTenant({ slug: "acme", name: "Acme" });
    globex = await createTenant({ slug: "globex", name: "Globex" });

    acmeScope = { organizationId: acme.organization.id };
    globexScope = { organizationId: globex.organization.id };

    await sqlTestPool().query(`UPDATE organizations SET join_code = $2 WHERE id = $1`, [
      acme.organization.id,
      ACME_CODE,
    ]);
    await sqlTestPool().query(`UPDATE organizations SET join_code = $2 WHERE id = $1`, [
      globex.organization.id,
      GLOBEX_CODE,
    ]);
  });

  afterAll(async () => {
    await resetDatabase();
    await disconnectTestDb();
  });

  beforeEach(() => {
    // Signup is rate limited per address and every test here signs up from the
    // same "unknown" key, so the window has to be cleared between them.
    __resetRateLimits();
  });

  // -------------------------------------------------------------------------

  describe("signup", () => {
    it("creates an account that is PENDING and EMPLOYEE", async () => {
      const created = await requestAccess("pending.one@acme.test");

      expect(created.status).toBe("PENDING");
      expect(await roleOf(created.id)).toBe("EMPLOYEE");
    });

    it("attaches the account to the organisation owning the code", async () => {
      const created = await requestAccess("scoped@globex.test", GLOBEX_CODE);

      const found = await userRepository.findById(globexScope, created.id);
      expect(found?.email).toBe("scoped@globex.test");

      // And is invisible from the other tenant.
      expect(await userRepository.findById(acmeScope, created.id)).toBeNull();
    });

    it("stores a password hash rather than the password", async () => {
      const created = await requestAccess("hashed@acme.test");

      const { rows } = await sqlTestPool().query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [created.id],
      );

      expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0]!.password_hash).not.toContain("correct-horse");
    });

    it("refuses an unknown organisation code", async () => {
      await expect(
        signUp({
          fullName: "Nobody",
          email: "nobody@nowhere.test",
          phone: "+91 90000 00000",
          organizationCode: "NOTAREALCODE",
          password: "correct-horse-battery-staple",
          confirmPassword: "correct-horse-battery-staple",
        }),
      ).rejects.toThrow(/organisation code/i);
    });

    it("cannot be used to hold a session", async () => {
      const created = await requestAccess("nosession@acme.test");
      expect(await canHoldSession(created.id)).toBe(false);
    });

    it("records the request in the audit log", async () => {
      const created = await requestAccess("audited@acme.test");

      const { rows } = await sqlTestPool().query<{ action: string; entity_id: string }>(
        `SELECT action, entity_id FROM audit_logs
          WHERE entity_id = $1 AND action = 'USER_SIGNUP'`,
        [created.id],
      );

      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("approval", () => {
    it("moves the account to ACTIVE with the chosen role", async () => {
      const created = await requestAccess("approve.me@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      const result = await userAccessService.approve(owner, created.id, { role: "MANAGER" });

      expect(result.status).toBe("ACTIVE");
      expect(result.role).toBe("MANAGER");
      expect(await canHoldSession(created.id)).toBe(true);
    });

    it("refuses to approve the same request twice", async () => {
      const created = await requestAccess("approve.once@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      await expect(
        userAccessService.approve(owner, created.id, { role: "HR" }),
      ).rejects.toThrow(/already been decided/i);
    });

    it("refuses a role the approver could not otherwise grant", async () => {
      const created = await requestAccess("noescalation@acme.test");
      const hr = sessionFor(acme.organization.id, { id: acme.user.id, role: "HR" });

      // HR may approve, but not as HR — that would let HR clone itself.
      await expect(
        userAccessService.approve(hr, created.id, { role: "HR" as UserRole }),
      ).rejects.toThrow(/can't assign/i);

      // And the account is untouched by the refusal.
      expect(await statusOf(created.id)).toBe("PENDING");
    });

    it("records the decision in the audit log", async () => {
      const created = await requestAccess("audit.approve@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      const { rows } = await sqlTestPool().query(
        `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'USER_APPROVED'`,
        [created.id],
      );
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("rejection", () => {
    it("moves the account to REJECTED and leaves it unable to sign in", async () => {
      const created = await requestAccess("reject.me@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      const result = await userAccessService.reject(owner, created.id, {});

      expect(result.status).toBe("REJECTED");
      expect(await canHoldSession(created.id)).toBe(false);
    });

    it("cannot be reversed by re-approving", async () => {
      const created = await requestAccess("reject.final@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.reject(owner, created.id, {});

      await expect(
        userAccessService.approve(owner, created.id, { role: "EMPLOYEE" }),
      ).rejects.toThrow(/already been decided/i);
    });
  });

  // -------------------------------------------------------------------------

  describe("disabling", () => {
    it("stops an active account signing in", async () => {
      const created = await requestAccess("disable.me@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });
      expect(await canHoldSession(created.id)).toBe(true);

      const result = await userAccessService.setStatus(owner, created.id, { status: "DISABLED" });

      expect(result.status).toBe("DISABLED");
      expect(await canHoldSession(created.id)).toBe(false);
    });

    it("revokes the sessions the account already holds", async () => {
      const created = await requestAccess("disable.sessions@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      await sqlTestPool().query(
        `INSERT INTO sessions (organization_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '14 days')`,
        [acme.organization.id, created.id, `hash-${created.id}`],
      );

      await userAccessService.setStatus(owner, created.id, { status: "DISABLED" });

      const { rows } = await sqlTestPool().query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM sessions WHERE user_id = $1`,
        [created.id],
      );

      expect(rows[0]!.revoked_at).not.toBeNull();
    });

    it("can be reversed by re-enabling", async () => {
      const created = await requestAccess("reenable@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });
      await userAccessService.setStatus(owner, created.id, { status: "DISABLED" });
      await userAccessService.setStatus(owner, created.id, { status: "ACTIVE" });

      expect(await canHoldSession(created.id)).toBe(true);
    });

    it("refuses to decide a pending request through the status route", async () => {
      const created = await requestAccess("wrongroute@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await expect(
        userAccessService.setStatus(owner, created.id, { status: "ACTIVE" }),
      ).rejects.toThrow(/approve or reject/i);
    });
  });

  // -------------------------------------------------------------------------

  describe("role changes", () => {
    it("an administrator can change a junior's role", async () => {
      const created = await requestAccess("promote.me@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      const result = await userAccessService.changeRole(owner, created.id, {
        role: "MANAGER",
        expectedRole: "EMPLOYEE",
      });

      expect(result.role).toBe("MANAGER");
    });

    it("refuses a stale expectedRole", async () => {
      const created = await requestAccess("stale.role@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      await expect(
        userAccessService.changeRole(owner, created.id, {
          role: "MANAGER",
          expectedRole: "HR",
        }),
      ).rejects.toThrow(/changed while you were viewing/i);
    });

    it("nobody can change their own role", async () => {
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await expect(
        userAccessService.changeRole(owner, acme.user.id, {
          role: "EMPLOYEE",
          expectedRole: "OWNER",
        }),
      ).rejects.toThrow(/your own access/i);

      expect(await roleOf(acme.user.id)).toBe("OWNER");
    });

    it("an employee cannot promote themselves even with a forged request", async () => {
      const created = await requestAccess("selfpromote@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });
      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      // The employee's own session, aiming at their own account.
      const employee = sessionFor(acme.organization.id, { id: created.id, role: "EMPLOYEE" });

      await expect(
        userAccessService.changeRole(employee, created.id, {
          role: "MANAGER",
          expectedRole: "EMPLOYEE",
        }),
      ).rejects.toThrow(/your own access/i);

      expect(await roleOf(created.id)).toBe("EMPLOYEE");
    });

    it("an employee cannot approve somebody else", async () => {
      const insider = await requestAccess("insider@acme.test");
      const outsider = await requestAccess("outsider@acme.test");

      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });
      await userAccessService.approve(owner, insider.id, { role: "EMPLOYEE" });

      const employee = sessionFor(acme.organization.id, { id: insider.id, role: "EMPLOYEE" });

      await expect(
        userAccessService.approve(employee, outsider.id, { role: "MANAGER" }),
      ).rejects.toThrow(/role below your own/i);

      expect(await statusOf(outsider.id)).toBe("PENDING");
    });

    it("an HR admin cannot disable the owner", async () => {
      const hr = sessionFor(acme.organization.id, { id: acme.user.id, role: "HR" });

      // Aimed at Globex's owner would be a 404; aim at Acme's own owner, whose
      // role outranks HR. The actor id differs so this is not self-action.
      const created = await requestAccess("hr.actor@acme.test");
      const hrActor = sessionFor(acme.organization.id, { id: created.id, role: "HR" });

      await expect(
        userAccessService.setStatus(hrActor, acme.user.id, { status: "DISABLED" }),
      ).rejects.toThrow(/role below your own/i);

      expect(await statusOf(acme.user.id)).toBe("ACTIVE");
      expect(hr.user.role).toBe("HR");
    });
  });

  // -------------------------------------------------------------------------

  describe("tenant isolation", () => {
    it("an owner cannot read another organisation's user", async () => {
      expect(await userRepository.findById(acmeScope, globex.user.id)).toBeNull();
    });

    it("an owner cannot approve another organisation's pending request", async () => {
      const foreign = await requestAccess("foreign.pending@globex.test", GLOBEX_CODE);
      const acmeOwner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      // 404, not 403: a 403 would confirm the id exists somewhere.
      await expect(
        userAccessService.approve(acmeOwner, foreign.id, { role: "EMPLOYEE" }),
      ).rejects.toThrow(/doesn't exist/i);

      expect(await statusOf(foreign.id)).toBe("PENDING");
    });

    it("an owner cannot disable another organisation's user", async () => {
      const acmeOwner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await expect(
        userAccessService.setStatus(acmeOwner, globex.user.id, { status: "DISABLED" }),
      ).rejects.toThrow(/doesn't exist/i);

      expect(await statusOf(globex.user.id)).toBe("ACTIVE");
    });

    it("an owner cannot re-role another organisation's user", async () => {
      const acmeOwner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await expect(
        userAccessService.changeRole(acmeOwner, globex.user.id, {
          role: "EMPLOYEE",
          expectedRole: "OWNER",
        }),
      ).rejects.toThrow(/doesn't exist/i);

      expect(await roleOf(globex.user.id)).toBe("OWNER");
    });

    it("an owner cannot revoke another organisation's sessions", async () => {
      const acmeOwner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await expect(
        userAccessService.revokeSessions(acmeOwner, globex.user.id),
      ).rejects.toThrow(/doesn't exist/i);
    });

    it("the listing shows only the caller's own organisation", async () => {
      const acmeOwner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });
      const page = await userAccessService.list(acmeOwner, { page: 1, pageSize: 100 });

      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.some((user) => user.id === globex.user.id)).toBe(false);
    });

    it("stats count only the caller's own organisation", async () => {
      const acmeOwner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });
      const globexOwner = sessionFor(globex.organization.id, {
        id: globex.user.id,
        role: "OWNER",
      });

      const [acmeStats, globexStats] = await Promise.all([
        userAccessService.stats(acmeOwner),
        userAccessService.stats(globexOwner),
      ]);

      const { rows } = await sqlTestPool().query<{ count: string }>(
        `SELECT count(*) FROM users WHERE organization_id = $1 AND deleted_at IS NULL`,
        [acme.organization.id],
      );

      expect(acmeStats.total).toBe(Number.parseInt(rows[0]!.count, 10));
      expect(globexStats.total).toBeLessThan(acmeStats.total);
    });
  });

  // -------------------------------------------------------------------------

  describe("session revocation", () => {
    it("ends every live session without changing the account status", async () => {
      const created = await requestAccess("revoke.me@acme.test");
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.approve(owner, created.id, { role: "EMPLOYEE" });

      await sqlTestPool().query(
        `INSERT INTO sessions (organization_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '14 days'),
                ($1, $2, $4, NOW() + INTERVAL '14 days')`,
        [acme.organization.id, created.id, `revoke-a-${created.id}`, `revoke-b-${created.id}`],
      );

      const result = await userAccessService.revokeSessions(owner, created.id);

      expect(result.revoked).toBe(2);
      // Still able to sign in again — revoking is not disabling.
      expect(await canHoldSession(created.id)).toBe(true);

      const { rows } = await sqlTestPool().query<{ live: string }>(
        `SELECT count(*) AS live FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [created.id],
      );
      expect(Number.parseInt(rows[0]!.live, 10)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe("invitations", () => {
    it("creates an INVITED account with no password", async () => {
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      const invited = await userAccessService.invite(owner, {
        fullName: "Priya Nair",
        email: "priya@acme.test",
        role: "MANAGER",
      });

      expect(invited.status).toBe("INVITED");
      expect(invited.role).toBe("MANAGER");
      expect(invited.hasPassword).toBe(false);
      // Cannot sign in until a password is set, which is what activates it.
      expect(await canHoldSession(invited.id)).toBe(false);
    });

    it("refuses a role the inviter could not grant", async () => {
      const created = await requestAccess("hr.inviter@acme.test");
      const hrActor = sessionFor(acme.organization.id, { id: created.id, role: "HR" });

      await expect(
        userAccessService.invite(hrActor, {
          fullName: "Escalation Attempt",
          email: "escalate@acme.test",
          role: "HR",
        }),
      ).rejects.toThrow(/can't assign/i);
    });

    it("refuses an address already used in the organisation", async () => {
      const owner = sessionFor(acme.organization.id, { id: acme.user.id, role: "OWNER" });

      await userAccessService.invite(owner, {
        fullName: "First Claim",
        email: "duplicate@acme.test",
        role: "EMPLOYEE",
      });

      await expect(
        userAccessService.invite(owner, {
          fullName: "Second Claim",
          email: "duplicate@acme.test",
          role: "EMPLOYEE",
        }),
      ).rejects.toThrow(/already uses that address/i);
    });
  });
});
