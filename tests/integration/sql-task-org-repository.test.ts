import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Executor } from "@/server/db/query";
import type { TaskQuery } from "@/lib/validation/task";
import type { TenantScope } from "@/server/db/tenant";
import {
  sqlAuditRepository,
  sqlNotificationRepository,
  sqlOrganizationRepository,
  sqlTeamRepository,
} from "@/server/repositories/sql/org-repository";
import { sqlTaskRepository } from "@/server/repositories/sql/task-repository";

import {
  createSqlTenant,
  disconnectSqlTestDb,
  hasSqlTestDatabase,
  resetSqlDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

const describeSql = hasSqlTestDatabase ? describe : describe.skip;

/**
 * The repository takes a fully validated TaskQuery, so tests build one the same
 * way the route does rather than the signature being widened for their benefit.
 */
function taskQuery(overrides: Partial<TaskQuery> = {}): TaskQuery {
  return {
    page: 1,
    pageSize: 20,
    scope: "all",
    sortBy: "dueDate",
    sortOrder: "asc",
    ...overrides,
  };
}

function scopeFor(organizationId: string): TenantScope {
  return { organizationId, tx: sqlTestPool() as unknown as Executor };
}

async function seedEmployee(organizationId: string, code: string, firstName: string) {
  const { rows } = await sqlTestPool().query<{ id: string }>(
    `INSERT INTO employees (organization_id, employee_code, first_name, last_name,
                            email, designation, joined_at, status)
     VALUES ($1,$2,$3,'Tester',$4,'Engineer',NOW(),'ACTIVE') RETURNING id`,
    [organizationId, code, firstName, `${code.toLowerCase()}@example.test`],
  );
  return rows[0]!.id;
}

async function seedUser(organizationId: string, email: string) {
  const { rows } = await sqlTestPool().query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, role)
     VALUES ($1,$2,'Test User','EMPLOYEE') RETURNING id`,
    [organizationId, email],
  );
  return rows[0]!.id;
}

describeSql("sql task and org repositories", () => {
  let orgId: string;
  let otherOrgId: string;
  let scope: TenantScope;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    await resetSqlDatabase();
    orgId = await createSqlTenant("task-co", "Task Co");
    otherOrgId = await createSqlTenant("other-co", "Other Co");
    scope = scopeFor(orgId);
    alice = await seedEmployee(orgId, "EMP-A", "Alice");
    bob = await seedEmployee(orgId, "EMP-B", "Bob");
  });

  afterAll(async () => {
    await disconnectSqlTestDb();
  });

  describe("tasks", () => {
    it("numbers references per tenant, starting at 1", async () => {
      await sqlTaskRepository.create(scope, { title: "First", creatorId: alice });
      await sqlTaskRepository.create(scope, { title: "Second", creatorId: alice });

      const foreignEmployee = await seedEmployee(otherOrgId, "EMP-X", "Xena");
      await sqlTaskRepository.create(scopeFor(otherOrgId), {
        title: "Theirs",
        creatorId: foreignEmployee,
      });

      const ours = await sqlTaskRepository.list(scope, taskQuery(), null);
      const theirs = await sqlTaskRepository.list(scopeFor(otherOrgId), taskQuery(), null);

      expect(ours.items.map((task) => task.reference).sort()).toEqual([1, 2]);
      // A second tenant restarts at 1 — references are per organisation.
      expect(theirs.items.map((task) => task.reference)).toEqual([1]);
    });

    it("keeps exactly one owner among the assignees", async () => {
      const id = await sqlTaskRepository.create(scope, {
        title: "Shared",
        creatorId: alice,
        assigneeIds: [alice, bob],
        ownerId: bob,
      });

      const task = await sqlTaskRepository.requireById(scope, id);
      const owners = task.assignees.filter((assignee) => assignee.isOwner);

      expect(task.assignees).toHaveLength(2);
      expect(owners).toHaveLength(1);
      expect(owners[0]!.employee.id).toBe(bob);
    });

    it("falls back to the first assignee when the named owner is not one", async () => {
      const id = await sqlTaskRepository.create(scope, {
        title: "Orphan owner",
        assigneeIds: [alice],
        ownerId: bob,
      });

      const task = await sqlTaskRepository.requireById(scope, id);
      expect(task.assignees.filter((a) => a.isOwner)).toHaveLength(1);
      expect(task.assignees[0]!.employee.id).toBe(alice);
    });

    it("will not attach an employee from another tenant", async () => {
      const foreign = await seedEmployee(otherOrgId, "EMP-X", "Xena");

      const id = await sqlTaskRepository.create(scope, {
        title: "Cross tenant",
        assigneeIds: [alice, foreign],
        ownerId: alice,
      });

      const task = await sqlTaskRepository.requireById(scope, id);
      expect(task.assignees.map((a) => a.employee.id)).toEqual([alice]);
    });

    describe("the visibility envelope", () => {
      beforeEach(async () => {
        await sqlTaskRepository.create(scope, {
          title: "Alice's",
          creatorId: alice,
          assigneeIds: [alice],
        });
        await sqlTaskRepository.create(scope, {
          title: "Bob's",
          creatorId: bob,
          assigneeIds: [bob],
        });
      });

      it("null means no restriction", async () => {
        const page = await sqlTaskRepository.list(scope, taskQuery(), null);
        expect(page.total).toBe(2);
      });

      it("restricts to the listed employees", async () => {
        const page = await sqlTaskRepository.list(scope, taskQuery(), [alice]);

        expect(page.total).toBe(1);
        expect(page.items[0]!.title).toBe("Alice's");
      });

      it("an empty list shows nothing, rather than everything", async () => {
        // The dangerous failure: treating [] as falsy and skipping the filter.
        const page = await sqlTaskRepository.list(scope, taskQuery(), []);

        expect(page.total).toBe(0);
        expect(page.items).toEqual([]);
      });
    });

    describe("search", () => {
      beforeEach(async () => {
        await sqlTaskRepository.create(scope, {
          title: "Migrate the billing service",
          creatorId: alice,
          tags: ["backend"],
        });
        await sqlTaskRepository.create(scope, { title: "Redesign onboarding", creatorId: alice });
      });

      it("matches on title, case-insensitively", async () => {
        const page = await sqlTaskRepository.list(
          scope,
          taskQuery({ search: "BILLING" }),
          null,
        );
        expect(page.total).toBe(1);
      });

      it("treats a lone % as a literal, not a wildcard", async () => {
        const page = await sqlTaskRepository.list(
          scope,
          taskQuery({ search: "%" }),
          null,
        );
        // Unescaped, this LIKE pattern would match every task in the tenant.
        expect(page.total).toBe(0);
      });

      it("finds a task by its reference, with or without the prefix", async () => {
        const byNumber = await sqlTaskRepository.list(
          scope,
          taskQuery({ search: "2" }),
          null,
        );
        const byPrefix = await sqlTaskRepository.list(
          scope,
          taskQuery({ search: "TF-2" }),
          null,
        );

        expect(byNumber.items.some((task) => task.reference === 2)).toBe(true);
        expect(byPrefix.items.some((task) => task.reference === 2)).toBe(true);
      });

      it("matches a tag exactly", async () => {
        const page = await sqlTaskRepository.list(
          scope,
          taskQuery({ search: "backend" }),
          null,
        );
        expect(page.total).toBe(1);
      });
    });

    it("sorts undated tasks last in both directions", async () => {
      await sqlTaskRepository.create(scope, { title: "Undated", creatorId: alice });
      await sqlTaskRepository.create(scope, {
        title: "Dated",
        creatorId: alice,
        dueDate: new Date("2026-04-01T00:00:00.000Z"),
      });

      for (const sortOrder of ["asc", "desc"] as const) {
        const page = await sqlTaskRepository.list(
          scope,
          taskQuery({ sortBy: "dueDate", sortOrder }),
          null,
        );
        expect(page.items.at(-1)!.title).toBe("Undated");
      }
    });

    it("clears completedAt when a completed task reopens", async () => {
      const id = await sqlTaskRepository.create(scope, { title: "Reopen me", creatorId: alice });

      await sqlTaskRepository.update(scope, id, { status: "COMPLETED" });
      expect((await sqlTaskRepository.requireById(scope, id)).completedAt).not.toBeNull();

      await sqlTaskRepository.update(scope, id, { status: "IN_PROGRESS" });
      expect((await sqlTaskRepository.requireById(scope, id)).completedAt).toBeNull();
    });

    it("does not comment on a task in another tenant", async () => {
      const id = await sqlTaskRepository.create(scope, { title: "Ours", creatorId: alice });

      const commentId = await sqlTaskRepository.addComment(
        scopeFor(otherOrgId),
        id,
        alice,
        "Should not land",
      );

      expect(commentId).toBeNull();
      expect((await sqlTaskRepository.requireById(scope, id)).counts.comments).toBe(0);
    });

    it("raises NOT_FOUND for a task in another tenant", async () => {
      const id = await sqlTaskRepository.create(scope, { title: "Ours", creatorId: alice });

      await expect(sqlTaskRepository.requireById(scopeFor(otherOrgId), id)).rejects.toThrow(
        /not found/i,
      );
    });

    it("counts overdue work, excluding completed tasks", async () => {
      const past = new Date(Date.now() - 86_400_000);
      await sqlTaskRepository.create(scope, { title: "Late", creatorId: alice, dueDate: past });

      const done = await sqlTaskRepository.create(scope, {
        title: "Late but done",
        creatorId: alice,
        dueDate: past,
      });
      await sqlTaskRepository.update(scope, done, { status: "COMPLETED" });

      expect(await sqlTaskRepository.countOverdue(scope, null)).toBe(1);
    });
  });

  describe("teams", () => {
    let teamId: string;

    beforeEach(async () => {
      const team = await sqlTeamRepository.create(scope, {
        name: "Platform",
        slug: "platform",
        managerId: alice,
      });
      teamId = team.id;
    });

    it("returns an empty member list, not a phantom member", async () => {
      const team = await sqlTeamRepository.requireById(scope, teamId);

      expect(team.members).toEqual([]);
      expect(team.counts.members).toBe(0);
      expect(team.manager?.id).toBe(alice);
    });

    it("replaces members wholesale", async () => {
      await sqlTeamRepository.replaceMembers(scope, teamId, [alice, bob]);
      expect(await sqlTeamRepository.memberIds(scope, teamId)).toHaveLength(2);

      await sqlTeamRepository.replaceMembers(scope, teamId, [bob]);
      expect(await sqlTeamRepository.memberIds(scope, teamId)).toEqual([bob]);

      await sqlTeamRepository.replaceMembers(scope, teamId, []);
      expect(await sqlTeamRepository.memberIds(scope, teamId)).toEqual([]);
    });

    it("will not add an employee from another tenant", async () => {
      const foreign = await seedEmployee(otherOrgId, "EMP-X", "Xena");

      await sqlTeamRepository.replaceMembers(scope, teamId, [alice, foreign]);

      expect(await sqlTeamRepository.memberIds(scope, teamId)).toEqual([alice]);
    });

    it("lists teams an employee manages or belongs to", async () => {
      await sqlTeamRepository.replaceMembers(scope, teamId, [bob]);

      expect(await sqlTeamRepository.listForEmployee(scope, alice)).toHaveLength(1); // manages
      expect(await sqlTeamRepository.listForEmployee(scope, bob)).toHaveLength(1); // member
    });

    it("hides a soft-deleted team", async () => {
      expect(await sqlTeamRepository.softDelete(scope, teamId)).toBe(true);

      expect(await sqlTeamRepository.list(scope)).toEqual([]);
      expect(await sqlTeamRepository.findById(scope, teamId)).toBeNull();
    });

    it("does not delete another tenant's team", async () => {
      expect(await sqlTeamRepository.softDelete(scopeFor(otherOrgId), teamId)).toBe(false);
      expect(await sqlTeamRepository.findById(scope, teamId)).not.toBeNull();
    });
  });

  describe("notifications", () => {
    let userA: string;
    let userB: string;

    beforeEach(async () => {
      userA = await seedUser(orgId, "a@example.test");
      userB = await seedUser(orgId, "b@example.test");
    });

    it("inserts many in one statement", async () => {
      const inserted = await sqlNotificationRepository.createMany(scope, [
        { userId: userA, type: "TASK_ASSIGNED", title: "Task assigned", body: "A task was assigned to you" },
        { userId: userB, type: "TASK_ASSIGNED", title: "Task assigned", body: "A task was assigned to you" },
      ]);

      expect(inserted).toBe(2);
      expect(await sqlNotificationRepository.countUnread(scope, userA)).toBe(1);
    });

    it("inserts nothing for an empty list", async () => {
      expect(await sqlNotificationRepository.createMany(scope, [])).toBe(0);
    });

    it("will not let one user mark another's notification read", async () => {
      await sqlNotificationRepository.createMany(scope, [
        { userId: userA, type: "TASK_ASSIGNED", title: "For A", body: "Body" },
      ]);

      const [notification] = await sqlNotificationRepository.listForUser(scope, userA);

      expect(await sqlNotificationRepository.markRead(scope, userB, notification!.id)).toBe(false);
      expect(await sqlNotificationRepository.countUnread(scope, userA)).toBe(1);

      expect(await sqlNotificationRepository.markRead(scope, userA, notification!.id)).toBe(true);
      expect(await sqlNotificationRepository.countUnread(scope, userA)).toBe(0);
    });

    it("marks all of one user's notifications read, and only theirs", async () => {
      await sqlNotificationRepository.createMany(scope, [
        { userId: userA, type: "TASK_ASSIGNED", title: "One", body: "Body" },
        { userId: userA, type: "TASK_DUE_SOON", title: "Two", body: "Body" },
        { userId: userB, type: "TASK_ASSIGNED", title: "Theirs", body: "Body" },
      ]);

      expect(await sqlNotificationRepository.markAllRead(scope, userA)).toBe(2);
      expect(await sqlNotificationRepository.countUnread(scope, userB)).toBe(1);
    });
  });

  describe("audit log", () => {
    it("records an entry with its actor and change payload", async () => {
      const actor = await seedUser(orgId, "admin@example.test");

      await sqlAuditRepository.record(scope, {
        actorUserId: actor,
        action: "UPDATE",
        entityType: "employee",
        entityId: alice,
        summary: "Changed designation",
        changes: { designation: { from: "Engineer", to: "Senior Engineer" } },
      });

      const entries = await sqlAuditRepository.list(scope);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actor?.email).toBe("admin@example.test");
      expect(entries[0]!.changes).toEqual({
        designation: { from: "Engineer", to: "Senior Engineer" },
      });
    });

    it("survives an entry with no actor", async () => {
      await sqlAuditRepository.record(scope, {
        action: "CREATE",
        entityType: "system",
        summary: "Automated run",
      });

      const entries = await sqlAuditRepository.list(scope);
      expect(entries[0]!.actor).toBeNull();
    });

    it("filters by entity type", async () => {
      await sqlAuditRepository.record(scope, {
        action: "CREATE",
        entityType: "task",
        summary: "a",
      });
      await sqlAuditRepository.record(scope, {
        action: "CREATE",
        entityType: "employee",
        summary: "b",
      });

      expect(await sqlAuditRepository.list(scope, 50, "task")).toHaveLength(1);
      expect(await sqlAuditRepository.list(scope, 50)).toHaveLength(2);
    });

    it("does not show another tenant's entries", async () => {
      await sqlAuditRepository.record(scope, {
        action: "CREATE",
        entityType: "task",
        summary: "ours",
      });

      expect(await sqlAuditRepository.list(scopeFor(otherOrgId))).toEqual([]);
    });
  });

  describe("organisation policy", () => {
    it("returns the attendance policy defaults", async () => {
      const policy = await sqlOrganizationRepository.policy(orgId, sqlTestPool() as unknown as Executor);

      expect(policy.timezone).toBeTruthy();
      expect(policy.weekendDays).toBeInstanceOf(Array);
      expect(typeof policy.enforceGeofence).toBe("boolean");
      expect(policy.maxAccuracyMeters).toBeGreaterThan(0);
    });

    it("updates only the fields supplied", async () => {
      const before = await sqlOrganizationRepository.policy(orgId, sqlTestPool() as unknown as Executor);

      await sqlOrganizationRepository.update(orgId, { gracePeriodMinutes: 25 }, sqlTestPool() as unknown as Executor);
      const after = await sqlOrganizationRepository.policy(orgId, sqlTestPool() as unknown as Executor);

      expect(after.gracePeriodMinutes).toBe(25);
      expect(after.timezone).toBe(before.timezone);
      expect(after.maxAccuracyMeters).toBe(before.maxAccuracyMeters);
    });

    it("raises for an organisation that does not exist", async () => {
      await expect(
        sqlOrganizationRepository.policy("00000000-0000-0000-0000-000000000000", sqlTestPool() as unknown as Executor),
      ).rejects.toThrow();
    });
  });
});
