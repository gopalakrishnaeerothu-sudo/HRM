import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sqlEmployeeRepository } from "@/server/repositories/sql/employee-repository";
import type { Executor } from "@/server/db/query";
import type { TenantScope } from "@/server/db/tenant";
import {
  createSqlTenant,
  disconnectSqlTestDb,
  hasSqlTestDatabase,
  resetSqlDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

/**
 * The ported employee repository, against the SQL-migrated schema.
 *
 * This is the proof that the port preserves behaviour: the same tenant
 * isolation, the same pagination envelope, the same search, plus the recursive
 * report tree that replaced an iterative multi-query loop.
 */
describe.skipIf(!hasSqlTestDatabase)("sql employee repository", () => {
  let alpha: string;
  let beta: string;
  let alphaScope: TenantScope;
  let betaScope: TenantScope;

  /** Insert an employee directly, bypassing the repository under test. */
  async function insertEmployee(
    organizationId: string,
    overrides: Partial<{
      code: string;
      firstName: string;
      lastName: string;
      email: string;
      designation: string;
      managerId: string | null;
      status: string;
      departmentId: string | null;
    }> = {},
  ): Promise<string> {
    const code = overrides.code ?? `E-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await sqlTestPool().query<{ id: string }>(
      `INSERT INTO employees (
         organization_id, employee_code, first_name, last_name, email,
         designation, manager_id, status, department_id, joined_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING id`,
      [
        organizationId,
        code,
        overrides.firstName ?? "Test",
        overrides.lastName ?? "Person",
        overrides.email ?? `${code.toLowerCase()}@example.test`,
        overrides.designation ?? "Engineer",
        overrides.managerId ?? null,
        overrides.status ?? "ACTIVE",
        overrides.departmentId ?? null,
      ],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    await resetSqlDatabase();

    alpha = await createSqlTenant("alpha", "Alpha Corp");
    beta = await createSqlTenant("beta", "Beta Corp");
    // `tx` points the repository at the SQL-migrated test database. Without
    // it, `db()` resolves the pool from DATABASE_URL, which under Vitest is
    // the Prisma-shaped schema — a different column naming convention
    // entirely. Passing an executor explicitly is what `scope.tx` is for.
    alphaScope = { organizationId: alpha, tx: sqlTestPool() as unknown as Executor };
    betaScope = { organizationId: beta, tx: sqlTestPool() as unknown as Executor };
  });

  afterAll(async () => {
    await resetSqlDatabase();
    await disconnectSqlTestDb();
  });

  describe("tenant isolation", () => {
    it("reads its own employee", async () => {
      const id = await insertEmployee(alpha, { firstName: "Priya", lastName: "Nair" });

      const found = await sqlEmployeeRepository.findById(alphaScope, id);
      expect(found?.firstName).toBe("Priya");
    });

    it("cannot read another tenant's employee", async () => {
      const id = await insertEmployee(beta);

      expect(await sqlEmployeeRepository.findById(alphaScope, id)).toBeNull();
    });

    it("lists only its own employees", async () => {
      await insertEmployee(alpha, { firstName: "Alpha" });
      await insertEmployee(alpha, { firstName: "Alpha2" });
      await insertEmployee(beta, { firstName: "Beta" });

      const result = await sqlEmployeeRepository.list(alphaScope, {
        page: 1,
        pageSize: 50,
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(result.total).toBe(2);
      expect(result.items.every((employee) => employee.firstName.startsWith("Alpha"))).toBe(true);
    });

    it("cannot update another tenant's employee", async () => {
      const id = await insertEmployee(beta, { designation: "Engineer" });

      await expect(
        sqlEmployeeRepository.update(alphaScope, id, { designation: "Hijacked" }),
      ).rejects.toThrow();

      const { rows } = await sqlTestPool().query<{ designation: string }>(
        `SELECT designation FROM employees WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.designation).toBe("Engineer");
    });

    it("cannot soft-delete another tenant's employee", async () => {
      const id = await insertEmployee(beta);

      expect(await sqlEmployeeRepository.softDelete(betaScope, id)).toBe(true);

      const other = await insertEmployee(beta);
      expect(await sqlEmployeeRepository.softDelete(alphaScope, other)).toBe(false);
    });

    it("allows the same employee code in two organisations", async () => {
      await insertEmployee(alpha, { code: "SHARED-1", email: "a@alpha.test" });
      await expect(
        insertEmployee(beta, { code: "SHARED-1", email: "b@beta.test" }),
      ).resolves.toBeTruthy();

      // …but not twice within one.
      await expect(
        insertEmployee(alpha, { code: "SHARED-1", email: "c@alpha.test" }),
      ).rejects.toThrow();
    });
  });

  describe("pagination", () => {
    beforeEach(async () => {
      for (let index = 0; index < 12; index += 1) {
        await insertEmployee(alpha, {
          code: `P-${String(index).padStart(3, "0")}`,
          firstName: `Person${String(index).padStart(2, "0")}`,
        });
      }
    });

    it("returns a complete envelope on the first page", async () => {
      const page = await sqlEmployeeRepository.list(alphaScope, {
        page: 1,
        pageSize: 5,
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(page.items).toHaveLength(5);
      expect(page.total).toBe(12);
      expect(page.pageCount).toBe(3);
      expect(page.hasPrevious).toBe(false);
      expect(page.hasNext).toBe(true);
    });

    it("reports the last page correctly", async () => {
      const page = await sqlEmployeeRepository.list(alphaScope, {
        page: 3,
        pageSize: 5,
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(page.items).toHaveLength(2);
      expect(page.hasNext).toBe(false);
      expect(page.hasPrevious).toBe(true);
    });

    it("does not repeat or skip rows across pages", async () => {
      // The tie-breaker on e.id is what makes this true. Without it, rows with
      // equal sort keys can appear on two pages or on none.
      const seen = new Set<string>();

      for (const page of [1, 2, 3]) {
        const result = await sqlEmployeeRepository.list(alphaScope, {
          page,
          pageSize: 5,
          sortBy: "name",
          sortOrder: "asc",
        });
        for (const employee of result.items) seen.add(employee.id);
      }

      expect(seen.size).toBe(12);
    });

    it("counts the filtered set, not the whole table", async () => {
      await insertEmployee(alpha, { firstName: "Zebra", code: "Z-1" });

      const page = await sqlEmployeeRepository.list(alphaScope, {
        page: 1,
        pageSize: 5,
        search: "Zebra",
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(page.total).toBe(1);
      expect(page.pageCount).toBe(1);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await insertEmployee(alpha, {
        code: "ACME-001",
        firstName: "Priya",
        lastName: "Nair",
        email: "priya.nair@acme.test",
        designation: "Frontend Lead",
      });
      await insertEmployee(alpha, {
        code: "ACME-002",
        firstName: "Rahul",
        lastName: "Verma",
        email: "rahul@acme.test",
        designation: "Backend Engineer",
      });
    });

    const search = (term: string) =>
      sqlEmployeeRepository.list(alphaScope, {
        page: 1,
        pageSize: 20,
        search: term,
        sortBy: "name",
        sortOrder: "asc",
      });

    it.each([
      ["first name", "Priya"],
      ["partial name", "riy"],
      ["last name", "Nair"],
      ["full name", "Priya Nair"],
      ["email", "priya.nair@"],
      ["employee code", "ACME-001"],
      ["designation", "Frontend"],
    ])("matches on %s", async (_label, term) => {
      const result = await search(term);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.firstName).toBe("Priya");
    });

    it("is case insensitive", async () => {
      expect((await search("pRiYa")).items).toHaveLength(1);
    });

    it("treats SQL wildcards in the term as literal characters", async () => {
      // '%' is a parameter value, not part of the pattern the caller controls,
      // so it must not match everything.
      expect((await search("%")).items).toHaveLength(0);
      expect((await search("_")).items).toHaveLength(0);
    });

    it("does not match another tenant's employee", async () => {
      await insertEmployee(beta, { firstName: "Priya", lastName: "Other", email: "p@beta.test" });

      expect((await search("Priya")).items).toHaveLength(1);
    });
  });

  describe("report tree", () => {
    it("returns direct and indirect reports", async () => {
      const head = await insertEmployee(alpha, { code: "H-1", firstName: "Head" });
      const lead = await insertEmployee(alpha, { code: "L-1", firstName: "Lead", managerId: head });
      const junior = await insertEmployee(alpha, { code: "J-1", firstName: "Junior", managerId: lead });
      await insertEmployee(alpha, { code: "U-1", firstName: "Unrelated" });

      const reports = await sqlEmployeeRepository.listReportIds(alphaScope, head);

      expect(reports).toHaveLength(2);
      expect(reports).toContain(lead);
      expect(reports).toContain(junior);
    });

    it("returns nothing for someone with no reports", async () => {
      const solo = await insertEmployee(alpha, { code: "S-1" });
      expect(await sqlEmployeeRepository.listReportIds(alphaScope, solo)).toEqual([]);
    });

    it("terminates on a reporting cycle instead of recursing forever", async () => {
      // A cycle is a data error, but it must not hang the request. The
      // path-tracking guard in the CTE is what prevents that.
      const first = await insertEmployee(alpha, { code: "C-1" });
      const second = await insertEmployee(alpha, { code: "C-2", managerId: first });
      await sqlTestPool().query(`UPDATE employees SET manager_id = $1 WHERE id = $2`, [
        second,
        first,
      ]);

      const reports = await sqlEmployeeRepository.listReportIds(alphaScope, first);
      expect(reports).toContain(second);
      expect(reports.length).toBeLessThan(20);
    });

    it("never crosses a tenant boundary", async () => {
      const head = await insertEmployee(alpha, { code: "H-2" });
      await insertEmployee(beta, { code: "B-1", managerId: head });

      // The FK permits this row; the organisation filter is what excludes it.
      expect(await sqlEmployeeRepository.listReportIds(alphaScope, head)).toEqual([]);
    });
  });

  describe("aggregates and uniqueness", () => {
    it("counts by status", async () => {
      await insertEmployee(alpha, { code: "A-1", status: "ACTIVE" });
      await insertEmployee(alpha, { code: "A-2", status: "ACTIVE" });
      await insertEmployee(alpha, { code: "A-3", status: "ON_LEAVE" });
      await insertEmployee(beta, { code: "B-2", status: "ACTIVE" });

      const counts = await sqlEmployeeRepository.countByStatus(alphaScope);
      const byStatus = new Map(counts.map((row) => [row.status, row.count]));

      expect(byStatus.get("ACTIVE")).toBe(2);
      expect(byStatus.get("ON_LEAVE")).toBe(1);
    });

    it("counts by department, labelling the unassigned", async () => {
      const { rows } = await sqlTestPool().query<{ id: string }>(
        `INSERT INTO departments (organization_id, name, code) VALUES ($1,'Engineering','ENG') RETURNING id`,
        [alpha],
      );
      await insertEmployee(alpha, { code: "D-1", departmentId: rows[0]!.id });
      await insertEmployee(alpha, { code: "D-2" });

      const counts = await sqlEmployeeRepository.countByDepartment(alphaScope);
      const byName = new Map(counts.map((row) => [row.name, row.count]));

      expect(byName.get("Engineering")).toBe(1);
      expect(byName.get("Unassigned")).toBe(1);
    });

    it("detects a duplicate code within the tenant only", async () => {
      await insertEmployee(alpha, { code: "DUP-1" });

      expect(await sqlEmployeeRepository.isCodeTaken(alphaScope, "DUP-1")).toBe(true);
      expect(await sqlEmployeeRepository.isCodeTaken(betaScope, "DUP-1")).toBe(false);
    });

    it("excludes the row being edited from its own uniqueness check", async () => {
      const id = await insertEmployee(alpha, { code: "SELF-1", email: "self@alpha.test" });

      // Otherwise saving a record without changing its code would report a
      // conflict with itself.
      expect(await sqlEmployeeRepository.isCodeTaken(alphaScope, "SELF-1", id)).toBe(false);
      expect(await sqlEmployeeRepository.isEmailTaken(alphaScope, "self@alpha.test", id)).toBe(false);
    });
  });

  describe("soft delete", () => {
    it("hides the row from reads but keeps it in the table", async () => {
      const id = await insertEmployee(alpha, { code: "SD-1" });

      await sqlEmployeeRepository.softDelete(alphaScope, id);

      expect(await sqlEmployeeRepository.findById(alphaScope, id)).toBeNull();

      const { rows } = await sqlTestPool().query(`SELECT deleted_at FROM employees WHERE id = $1`, [
        id,
      ]);
      // History depends on the row surviving.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.deleted_at).not.toBeNull();
    });
  });
});
