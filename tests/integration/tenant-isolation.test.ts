import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { employeeRepository } from "@/server/repositories/employee-repository";
import { officeRepository } from "@/server/repositories/office-repository";
import { taskRepository } from "@/server/repositories/task-repository";
import { assertBelongsToTenant } from "@/server/db/tenant";
import type { TenantScope } from "@/server/db/tenant";
import {
  createSqlTenant2 as createTenant,
  disconnectSqlTestDb as disconnectTestDb,
  hasSqlTestDatabase as hasTestDatabase,
  resetSqlDatabase as resetDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

/**
 * Multi-tenant isolation.
 *
 * The single most important property in the system: organisation A must never
 * be able to read or write organisation B's data. These tests set up two real
 * tenants and try to cross the boundary through every repository entry point.
 *
 * Skipped when TEST_DATABASE_URL is unset — see tests/helpers/db.ts.
 */
describe.skipIf(!hasTestDatabase)("tenant isolation", () => {
  let acme: Awaited<ReturnType<typeof createTenant>>;
  let globex: Awaited<ReturnType<typeof createTenant>>;
  let acmeScope: TenantScope;
  let globexScope: TenantScope;

  beforeAll(async () => {
    await resetDatabase();

    acme = await createTenant({ slug: "acme", name: "Acme" });
    globex = await createTenant({
      slug: "globex",
      name: "Globex",
      officeLatitude: 17.44855,
      officeLongitude: 78.39109,
    });

    acmeScope = { organizationId: acme.organization.id };
    globexScope = { organizationId: globex.organization.id };
  });

  afterAll(async () => {
    await resetDatabase();
    await disconnectTestDb();
  });

  describe("employees", () => {
    it("cannot read another tenant's employee by id", async () => {
      const found = await employeeRepository.findById(acmeScope, globex.employee.id);
      expect(found).toBeNull();
    });

    it("reads its own employee", async () => {
      const found = await employeeRepository.findById(acmeScope, acme.employee.id);
      expect(found?.id).toBe(acme.employee.id);
    });

    it("lists only its own employees", async () => {
      const result = await employeeRepository.list(acmeScope, {
        page: 1,
        pageSize: 50,
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe(acme.employee.id);
    });

    it("cannot update another tenant's employee", async () => {
      await expect(
        employeeRepository.update(acmeScope, globex.employee.id, { designation: "Hijacked" }),
      ).rejects.toThrow();

      // Confirm nothing changed.
      const unchanged = await testDb().employee.findUnique({
        where: { id: globex.employee.id },
        select: { designation: true },
      });
      expect(unchanged?.designation).toBe("Founder");
    });

    it("cannot soft-delete another tenant's employee", async () => {
      const removed = await employeeRepository.softDelete(acmeScope, globex.employee.id);
      expect(removed).toBe(false);

      const alive = await testDb().employee.findUnique({
        where: { id: globex.employee.id },
        select: { deletedAt: true },
      });
      expect(alive?.deletedAt).toBeNull();
    });
  });

  describe("offices and geofences", () => {
    it("cannot read another tenant's office", async () => {
      const found = await officeRepository.findById(acmeScope, globex.office.id);
      expect(found).toBeNull();
    });

    it("cannot read a geofence through the office join", async () => {
      const globexZone = globex.office.geofences[0];
      const found = await officeRepository.findGeofence(acmeScope, globexZone.id);
      expect(found).toBeNull();
    });

    it("cannot widen another tenant's perimeter", async () => {
      const globexZone = globex.office.geofences[0];
      const updated = await officeRepository.updateGeofence(acmeScope, globexZone.id, {
        radiusMeters: 5000,
      });

      expect(updated).toBe(false);

      const unchanged = await testDb().officeGeofence.findUnique({
        where: { id: globexZone.id },
        select: { radiusMeters: true },
      });
      expect(unchanged?.radiusMeters).toBe(100);
    });

    it("returns no check-in zones for a foreign employee", async () => {
      const zones = await officeRepository.listZonesForEmployee(acmeScope, globex.employee.id);
      expect(zones).toHaveLength(0);
    });

    it("returns the employee's own zones", async () => {
      const zones = await officeRepository.listZonesForEmployee(acmeScope, acme.employee.id);
      expect(zones).toHaveLength(1);
      expect(zones[0]?.officeId).toBe(acme.office.id);
    });
  });

  describe("foreign-key guards", () => {
    it("rejects a foreign employee id used as a reference", async () => {
      await expect(
        assertBelongsToTenant(acmeScope, { employeeIds: [globex.employee.id] }),
      ).rejects.toThrow();
    });

    it("rejects a foreign office id", async () => {
      await expect(
        assertBelongsToTenant(acmeScope, { officeIds: [globex.office.id] }),
      ).rejects.toThrow();
    });

    it("accepts ids from the same tenant", async () => {
      await expect(
        assertBelongsToTenant(acmeScope, {
          employeeIds: [acme.employee.id],
          officeIds: [acme.office.id],
          departmentIds: [acme.department.id],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects a mixed batch containing one foreign id", async () => {
      await expect(
        assertBelongsToTenant(acmeScope, {
          employeeIds: [acme.employee.id, globex.employee.id],
        }),
      ).rejects.toThrow();
    });
  });

  describe("tasks", () => {
    it("keeps task references independent per tenant", async () => {
      const db = testDb();

      await db.task.create({
        data: {
          organizationId: acme.organization.id,
          reference: 1,
          title: "Acme task",
          creatorId: acme.employee.id,
        },
      });

      // The same reference number in another tenant must be allowed, because
      // the unique constraint is (organizationId, reference), not reference.
      await expect(
        db.task.create({
          data: {
            organizationId: globex.organization.id,
            reference: 1,
            title: "Globex task",
            creatorId: globex.employee.id,
          },
        }),
      ).resolves.toBeDefined();

      // The repository no longer exposes a nextReference() to read first —
      // the number is allocated inside the INSERT, so two concurrent creations
      // cannot both claim it. Assert the observable behaviour instead: each
      // tenant continues its own sequence rather than a global one.
      const acmeSecond = await taskRepository.create(acmeScope, {
        title: "Acme second",
        creatorId: acme.employee.id,
      });
      const globexSecond = await taskRepository.create(globexScope, {
        title: "Globex second",
        creatorId: globex.employee.id,
      });

      const acmeTask = await taskRepository.requireById(acmeScope, acmeSecond);
      const globexTask = await taskRepository.requireById(globexScope, globexSecond);

      expect(acmeTask.reference).toBe(2);
      expect(globexTask.reference).toBe(2);
    });

    it("cannot read another tenant's task", async () => {
      const globexTask = await testDb().task.findFirst({
        where: { organizationId: globex.organization.id },
        select: { id: true },
      });

      const found = await taskRepository.findById(acmeScope, globexTask!.id);
      expect(found).toBeNull();
    });

    it("lists only its own tasks", async () => {
      const result = await taskRepository.list(
        acmeScope,
        { page: 1, pageSize: 50, scope: "all", sortBy: "dueDate", sortOrder: "asc" },
        null,
      );

      expect(result.total).toBe(1);
      expect(result.items[0]?.title).toBe("Acme task");
    });
  });

  describe("per-tenant uniqueness", () => {
    it("allows the same employee code in two organisations", async () => {
      const db = testDb();

      await expect(
        db.employee.create({
          data: {
            organizationId: globex.organization.id,
            // Same code as Acme's employee — legal, because the constraint is
            // (organizationId, employeeCode).
            employeeCode: "EMP-0001-SHARED",
            firstName: "Globex",
            lastName: "Person",
            email: "shared@globex.example",
            designation: "Engineer",
            joinedAt: new Date("2024-01-01"),
          },
        }),
      ).resolves.toBeDefined();

      await expect(
        db.employee.create({
          data: {
            organizationId: acme.organization.id,
            employeeCode: "EMP-0001-SHARED",
            firstName: "Acme",
            lastName: "Person",
            email: "shared@acme.example",
            designation: "Engineer",
            joinedAt: new Date("2024-01-01"),
          },
        }),
      ).resolves.toBeDefined();
    });

    it("still rejects a duplicate code within one organisation", async () => {
      await expect(
        testDb().employee.create({
          data: {
            organizationId: acme.organization.id,
            employeeCode: "EMP-0001-SHARED",
            firstName: "Duplicate",
            lastName: "Person",
            email: "duplicate@acme.example",
            designation: "Engineer",
            joinedAt: new Date("2024-01-01"),
          },
        }),
      ).rejects.toThrow();
    });
  });
});
