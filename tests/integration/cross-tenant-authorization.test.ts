import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isAppError } from "@/lib/errors";
import { hashPassword } from "@/server/auth/password";
import { hasPermission } from "@/server/auth/permissions";
import type { AuthSession } from "@/server/auth/types";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { officeRepository } from "@/server/repositories/office-repository";
import { teamRepository } from "@/server/repositories/org-repository";
import { taskRepository } from "@/server/repositories/task-repository";
import { resolveVisibleEmployeeIds } from "@/server/services/access-service";
import { leaveService } from "@/server/services/leave-service";
import { taskService } from "@/server/services/task-service";
import { disconnectTestDb, hasTestDatabase, resetDatabase, testDb } from "../helpers/db";

/**
 * Cross-tenant authorization, end to end through the service layer.
 *
 * Two real organisations, real users in each, and an attempt to reach across
 * the boundary through every module the product exposes. `tenant-isolation`
 * covers the repository layer; this covers the *services*, which is where a
 * session is turned into an authorisation envelope — and therefore where a
 * subtle bug would actually let data escape.
 */
describe.skipIf(!hasTestDatabase)("cross-tenant authorization", () => {
  interface Tenant {
    organizationId: string;
    ownerSession: AuthSession;
    managerSession: AuthSession;
    employeeSession: AuthSession;
    employeeId: string;
    officeId: string;
    teamId: string;
    taskId: string;
  }

  let alpha: Tenant;
  let beta: Tenant;

  /** Build a session object the way the production adapter would. */
  function sessionFor(
    organizationId: string,
    organizationName: string,
    user: { id: string; email: string; name: string; role: AuthSession["user"]["role"] },
    employee: { id: string; firstName: string; lastName: string; managerId: string | null } | null,
  ): AuthSession {
    return {
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: null, role: user.role },
      organization: {
        id: organizationId,
        slug: organizationName.toLowerCase(),
        name: organizationName,
        timezone: "Asia/Kolkata",
      },
      employee: employee
        ? {
            id: employee.id,
            employeeCode: "E-1",
            firstName: employee.firstName,
            lastName: employee.lastName,
            designation: "Engineer",
            avatarUrl: null,
            departmentId: null,
            managerId: employee.managerId,
            primaryOfficeId: null,
          }
        : null,
      permissionOverrides: new Map(),
      strategy: "session-cookie",
    };
  }

  async function buildTenant(slug: string, name: string, latitude: number): Promise<Tenant> {
    const db = testDb();

    const organization = await db.organization.create({ data: { slug, name } });
    const organizationId = organization.id;

    const office = await db.office.create({
      data: {
        organizationId,
        name: `${name} HQ`,
        code: "HQ",
        addressLine: "1 Test Street",
        city: "Test",
        latitude,
        longitude: 80,
        geofences: {
          create: { name: "Main perimeter", latitude, longitude: 80, radiusMeters: 100, isPrimary: true },
        },
      },
    });

    const passwordHash = await hashPassword(`${slug}-password-2026`);

    const make = async (role: AuthSession["user"]["role"], suffix: string) => {
      const user = await db.user.create({
        data: {
          organizationId,
          email: `${suffix}@${slug}.example`,
          name: `${name} ${suffix}`,
          role,
          passwordHash,
        },
      });
      const employee = await db.employee.create({
        data: {
          organizationId,
          userId: user.id,
          employeeCode: `${suffix.toUpperCase()}-1`,
          firstName: name,
          lastName: suffix,
          email: `${suffix}@${slug}.example`,
          designation: "Engineer",
          primaryOfficeId: office.id,
          joinedAt: new Date("2025-01-01"),
        },
      });
      return { user, employee };
    };

    const owner = await make("OWNER", "owner");
    const manager = await make("MANAGER", "manager");
    const employee = await make("EMPLOYEE", "employee");

    // The employee reports to the manager, so the manager's envelope includes them.
    await db.employee.update({
      where: { id: employee.employee.id },
      data: { managerId: manager.employee.id },
    });

    const team = await db.team.create({
      data: {
        organizationId,
        name: `${name} Team`,
        slug: `${slug}-team`,
        managerId: manager.employee.id,
        members: { create: [{ employeeId: employee.employee.id }] },
      },
    });

    const task = await db.task.create({
      data: {
        organizationId,
        reference: 1,
        title: `${name} confidential task`,
        creatorId: owner.employee.id,
        assignees: { create: [{ employeeId: employee.employee.id, isOwner: true }] },
      },
    });

    await db.attendanceRecord.create({
      data: {
        organizationId,
        employeeId: employee.employee.id,
        officeId: office.id,
        date: new Date(Date.UTC(2026, 7, 3)),
        status: "PRESENT",
        workedMinutes: 480,
      },
    });

    await db.leave.create({
      data: {
        organizationId,
        employeeId: employee.employee.id,
        type: "CASUAL",
        status: "PENDING",
        startDate: new Date(Date.UTC(2026, 11, 1)),
        endDate: new Date(Date.UTC(2026, 11, 2)),
        days: 2,
        reason: `${name} leave request`,
      },
    });

    return {
      organizationId,
      ownerSession: sessionFor(organizationId, name, owner.user, {
        ...owner.employee,
        managerId: null,
      }),
      managerSession: sessionFor(organizationId, name, manager.user, {
        ...manager.employee,
        managerId: null,
      }),
      employeeSession: sessionFor(organizationId, name, employee.user, {
        ...employee.employee,
        managerId: manager.employee.id,
      }),
      employeeId: employee.employee.id,
      officeId: office.id,
      teamId: team.id,
      taskId: task.id,
    };
  }

  beforeAll(async () => {
    await resetDatabase();
    alpha = await buildTenant("alpha", "Alpha", 16.3);
    beta = await buildTenant("beta", "Beta", 17.4);
  });

  afterAll(async () => {
    await resetDatabase();
    await disconnectTestDb();
  });

  // --- Employees ------------------------------------------------------------

  describe("employees", () => {
    it("A's owner reads A's employee", async () => {
      const found = await employeeRepository.findById(
        { organizationId: alpha.organizationId },
        alpha.employeeId,
      );
      expect(found?.id).toBe(alpha.employeeId);
    });

    it("A's owner cannot read B's employee", async () => {
      const found = await employeeRepository.findById(
        { organizationId: alpha.organizationId },
        beta.employeeId,
      );
      expect(found).toBeNull();
    });

    it("A's owner cannot update B's employee", async () => {
      await expect(
        employeeRepository.update({ organizationId: alpha.organizationId }, beta.employeeId, {
          designation: "Compromised",
        }),
      ).rejects.toThrow();

      const untouched = await testDb().employee.findUnique({
        where: { id: beta.employeeId },
        select: { designation: true },
      });
      expect(untouched?.designation).toBe("Engineer");
    });
  });

  // --- Tasks ----------------------------------------------------------------

  describe("tasks", () => {
    it("A's owner opens A's task", async () => {
      const task = await taskService.detail(alpha.ownerSession, alpha.taskId);
      expect(task.title).toContain("Alpha");
    });

    it("A's owner gets 404 — not 403 — for B's task", async () => {
      // 403 would confirm the id exists somewhere, letting an attacker
      // enumerate another tenant's id space by watching status codes.
      await expect(taskService.detail(alpha.ownerSession, beta.taskId)).rejects.toSatisfy(
        (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
      );
    });

    it("A's owner cannot update B's task", async () => {
      await expect(
        taskService.update(alpha.ownerSession, beta.taskId, { title: "Hijacked" }),
      ).rejects.toThrow();

      const untouched = await testDb().task.findUnique({
        where: { id: beta.taskId },
        select: { title: true },
      });
      expect(untouched?.title).toContain("Beta");
    });

    it("A's task list contains only A's tasks", async () => {
      const result = await taskService.list(alpha.ownerSession, {
        page: 1,
        pageSize: 50,
        scope: "all",
        sortBy: "dueDate",
        sortOrder: "asc",
      });

      expect(result.total).toBe(1);
      expect(result.items.every((task) => task.title.includes("Alpha"))).toBe(true);
    });
  });

  // --- Teams, offices, attendance -------------------------------------------

  describe("teams and offices", () => {
    it("A cannot read B's team", async () => {
      const found = await teamRepository.findById({ organizationId: alpha.organizationId }, beta.teamId);
      expect(found).toBeNull();
    });

    it("A's team list excludes B's teams", async () => {
      const teams = await teamRepository.list({ organizationId: alpha.organizationId });
      expect(teams).toHaveLength(1);
      expect(teams[0]?.name).toContain("Alpha");
    });

    it("A cannot read B's office", async () => {
      const found = await officeRepository.findById(
        { organizationId: alpha.organizationId },
        beta.officeId,
      );
      expect(found).toBeNull();
    });

    it("A gets no check-in zones for B's employee", async () => {
      const zones = await officeRepository.listZonesForEmployee(
        { organizationId: alpha.organizationId },
        beta.employeeId,
      );
      expect(zones).toHaveLength(0);
    });
  });

  describe("attendance", () => {
    it("A's attendance list contains only A's records", async () => {
      const result = await attendanceRepository.list(
        { organizationId: alpha.organizationId },
        { from: new Date(Date.UTC(2026, 0, 1)), to: new Date(Date.UTC(2026, 11, 31)) },
        1,
        50,
      );

      expect(result.total).toBe(1);
      expect(result.items[0]?.employee.id).toBe(alpha.employeeId);
    });

    it("filtering by B's employee id from A's scope returns nothing", async () => {
      const result = await attendanceRepository.list(
        { organizationId: alpha.organizationId },
        {
          employeeIds: [beta.employeeId],
          from: new Date(Date.UTC(2026, 0, 1)),
          to: new Date(Date.UTC(2026, 11, 31)),
        },
        1,
        50,
      );

      // A supplied employee id is intersected with the tenant filter, never
      // trusted on its own.
      expect(result.total).toBe(0);
    });
  });

  // --- Leave ----------------------------------------------------------------

  describe("leave", () => {
    it("A's owner sees only A's pending requests", async () => {
      const pending = await leaveService.listForReview(alpha.ownerSession);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.reason).toContain("Alpha");
    });

    it("A's owner cannot approve B's leave request", async () => {
      const betaLeave = await testDb().leave.findFirst({
        where: { organizationId: beta.organizationId },
        select: { id: true },
      });

      await expect(
        leaveService.review(alpha.ownerSession, betaLeave!.id, { decision: "APPROVED" }),
      ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "NOT_FOUND");

      const untouched = await testDb().leave.findUnique({
        where: { id: betaLeave!.id },
        select: { status: true },
      });
      expect(untouched?.status).toBe("PENDING");
    });
  });

  // --- Visibility envelopes -------------------------------------------------

  describe("visibility envelopes", () => {
    it("an owner sees the whole organisation", async () => {
      // null means "unrestricted within the tenant" — never across tenants.
      expect(await resolveVisibleEmployeeIds(alpha.ownerSession)).toBeNull();
    });

    it("a manager sees themselves and their reports, and nobody from B", async () => {
      const envelope = await resolveVisibleEmployeeIds(alpha.managerSession);

      expect(envelope).not.toBeNull();
      expect(envelope).toContain(alpha.employeeId);
      expect(envelope).not.toContain(beta.employeeId);
    });

    it("an employee sees only themselves", async () => {
      const envelope = await resolveVisibleEmployeeIds(alpha.employeeSession);
      expect(envelope).toEqual([alpha.employeeSession.employee!.id]);
    });

    it("a manager cannot widen their envelope by asking for organisation scope", async () => {
      const tasks = await taskService.list(alpha.managerSession, {
        page: 1,
        pageSize: 50,
        // A client-supplied scope is a request, not a grant.
        scope: "all",
        sortBy: "dueDate",
        sortOrder: "asc",
      });

      expect(tasks.items.every((task) => task.title.includes("Alpha"))).toBe(true);
    });
  });

  // --- Role boundaries ------------------------------------------------------

  describe("role boundaries", () => {
    it("an employee holds none of the administrative permissions", () => {
      for (const permission of [
        "employee:create",
        "employee:update",
        "attendance:override",
        "geofence:manage",
        "settings:manage",
        "audit:read",
        "report:export",
      ] as const) {
        expect(hasPermission("EMPLOYEE", permission)).toBe(false);
      }
    });

    it("a manager cannot change organisation settings or geofences", () => {
      expect(hasPermission("MANAGER", "settings:manage")).toBe(false);
      expect(hasPermission("MANAGER", "geofence:manage")).toBe(false);
      expect(hasPermission("MANAGER", "attendance:override")).toBe(false);
    });

    it("an employee cannot approve leave", async () => {
      // Not merely hidden in the UI: the service returns nothing to act on.
      expect(hasPermission("EMPLOYEE", "leave:approve")).toBe(false);
      expect(await leaveService.listForReview(alpha.employeeSession)).toEqual([]);
    });
  });

  // --- Account state --------------------------------------------------------

  describe("account state", () => {
    it("a suspended employee loses their employee identity", async () => {
      const db = testDb();

      const user = await db.user.create({
        data: {
          organizationId: alpha.organizationId,
          email: "suspended@alpha.example",
          name: "Suspended Person",
          role: "EMPLOYEE",
          passwordHash: await hashPassword("suspended-user-2026"),
        },
      });
      await db.employee.create({
        data: {
          organizationId: alpha.organizationId,
          userId: user.id,
          employeeCode: "SUS-1",
          firstName: "Suspended",
          lastName: "Person",
          email: "suspended@alpha.example",
          designation: "Engineer",
          joinedAt: new Date("2025-01-01"),
          status: "SUSPENDED",
        },
      });

      const { loadAuthSession } = await import("@/server/auth/production-adapter");
      const session = await loadAuthSession(user.id, "session-cookie");

      // The user can still authenticate, but employee-scoped actions —
      // check-in, leave, attendance — have no identity to act on.
      expect(session).not.toBeNull();
      expect(session?.employee).toBeNull();
    });

    it("a disabled user gets no session at all", async () => {
      const db = testDb();

      const user = await db.user.create({
        data: {
          organizationId: alpha.organizationId,
          email: "disabled@alpha.example",
          name: "Disabled Person",
          role: "EMPLOYEE",
          status: "DISABLED",
          passwordHash: await hashPassword("disabled-user-2026"),
        },
      });

      const { loadAuthSession } = await import("@/server/auth/production-adapter");
      expect(await loadAuthSession(user.id, "session-cookie")).toBeNull();
    });
  });
});
