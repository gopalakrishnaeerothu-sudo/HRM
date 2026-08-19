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
      const { rows: unchanged } = await sqlTestPool().query<{ designation: string }>(
        `SELECT designation FROM employees WHERE id = $1`,
        [globex.employee.id],
      );
      expect(unchanged[0]?.designation).toBe("Founder");
    });

    it("cannot soft-delete another tenant's employee", async () => {
      const removed = await employeeRepository.softDelete(acmeScope, globex.employee.id);
      expect(removed).toBe(false);

      const { rows: alive } = await sqlTestPool().query<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM employees WHERE id = $1`,
        [globex.employee.id],
      );
      expect(alive[0]?.deleted_at).toBeNull();
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

      const { rows: unchanged } = await sqlTestPool().query<{ radius_meters: number }>(
        `SELECT radius_meters FROM office_geofences WHERE id = $1`,
        [globexZone.id],
      );
      expect(unchanged[0]?.radius_meters).toBe(100);
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
      await taskRepository.create(acmeScope, {
        title: "Acme task",
        creatorId: acme.employee.id,
      });

      // The same reference number in another tenant must be allowed, because
      // the unique constraint is (organizationId, reference), not reference.
      await expect(
        taskRepository.create(globexScope, {
          title: "Globex task",
          creatorId: globex.employee.id,
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
      const { rows: globexTasks } = await sqlTestPool().query<{ id: string }>(
        `SELECT id FROM tasks WHERE organization_id = $1 LIMIT 1`,
        [globex.organization.id],
      );

      const found = await taskRepository.findById(acmeScope, globexTasks[0]!.id);
      expect(found).toBeNull();
    });

    it("lists only its own tasks", async () => {
      const result = await taskRepository.list(
        acmeScope,
        { page: 1, pageSize: 50, scope: "all", sortBy: "dueDate", sortOrder: "asc" },
        null,
      );

      // Assert the property, not a count. A count couples this test to how
      // many tasks every other test in the file happens to create, which is
      // how a tenant-isolation test ends up failing for a reason that has
      // nothing to do with tenant isolation.
      expect(result.total).toBeGreaterThan(0);
      expect(result.items.every((task) => task.title.startsWith("Acme"))).toBe(true);
      expect(result.items.some((task) => task.title.includes("Globex"))).toBe(false);
    });
  });

  describe("per-tenant uniqueness", () => {
    const insertEmployee = (organizationId: string, code: string, email: string) =>
      sqlTestPool().query(
        `INSERT INTO employees (organization_id, employee_code, first_name,
                                last_name, email, designation, joined_at)
         VALUES ($1, $2, 'Test', 'Person', $3, 'Engineer', '2024-01-01')`,
        [organizationId, code, email],
      );

    it("allows the same employee code in two organisations", async () => {
      // Legal, because the constraint is (organization_id, employee_code) —
      // a global unique code would leak the fact that another tenant used it.
      await expect(
        insertEmployee(globex.organization.id, "EMP-0001-SHARED", "shared@globex.example"),
      ).resolves.toBeDefined();

      await expect(
        insertEmployee(acme.organization.id, "EMP-0001-SHARED", "shared@acme.example"),
      ).resolves.toBeDefined();
    });

    it("still rejects a duplicate code within one organisation", async () => {
      await insertEmployee(acme.organization.id, "EMP-0002-SHARED", "one@acme.example");

      await expect(
        insertEmployee(acme.organization.id, "EMP-0002-SHARED", "two@acme.example"),
      ).rejects.toThrow();
    });
  });
});
