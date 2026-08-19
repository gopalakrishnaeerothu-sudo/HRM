import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { leaveRepository } from "@/server/repositories/leave-repository";
import type { TenantScope } from "@/server/db/tenant";
import {
  createSqlTenant,
  disconnectSqlTestDb,
  hasSqlTestDatabase,
  resetSqlDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

/**
 * The ported leave repository.
 *
 * The behaviour worth pinning here is the overlap rule and the review guard.
 * Overlap detection is what produces the 409 the API contract promises, and
 * the `status = 'PENDING'` condition inside the review UPDATE is what makes
 * two simultaneous reviewers produce one decision rather than a silent
 * last-write-wins.
 */
describe.skipIf(!hasSqlTestDatabase)("sql leave repository", () => {
  let alpha: string;
  let beta: string;
  let alphaScope: TenantScope;
  let betaScope: TenantScope;
  let requester: string;
  let reviewer: string;

  const day = (year: number, month: number, date: number) => new Date(Date.UTC(year, month, date));

  async function insertEmployee(organizationId: string, code: string): Promise<string> {
    const { rows } = await sqlTestPool().query<{ id: string }>(
      `INSERT INTO employees (organization_id, employee_code, first_name, last_name,
                              email, designation, joined_at)
       VALUES ($1, $2, 'Test', $2, $3, 'Engineer', NOW())
       RETURNING id`,
      [organizationId, code, `${code.toLowerCase()}@example.test`],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    await resetSqlDatabase();
    alpha = await createSqlTenant("alpha-leave", "Alpha");
    beta = await createSqlTenant("beta-leave", "Beta");
    alphaScope = { organizationId: alpha };
    betaScope = { organizationId: beta };
    requester = await insertEmployee(alpha, "REQ1");
    reviewer = await insertEmployee(alpha, "REV1");
  });

  afterAll(disconnectSqlTestDb);

  async function request(startDay: number, endDay: number, days: number) {
    return leaveRepository.create(alphaScope, {
      employeeId: requester,
      type: "CASUAL",
      startDate: day(2027, 2, startDay),
      endDate: day(2027, 2, endDay),
      days,
      reason: "test",
    });
  }

  it("creates a pending request with the employee joined in", async () => {
    const created = await request(1, 5, 5);

    expect(created.status).toBe("PENDING");
    expect(created.days).toBe(5);
    expect(created.employee.id).toBe(requester);
    expect(created.reviewer).toBeNull();
  });

  it("keeps fractional half-days intact through NUMERIC", async () => {
    // NUMERIC comes back from pg as a string; reading it as a float without
    // care is how 0.5 becomes 0 and a half-day disappears.
    const created = await request(10, 10, 0.5);
    expect(created.days).toBe(0.5);
  });

  describe("overlap detection", () => {
    beforeEach(async () => {
      await request(10, 20, 11);
    });

    it.each([
      ["identical range", 10, 20],
      ["fully inside", 12, 15],
      ["straddling the start", 5, 12],
      ["straddling the end", 18, 25],
      ["fully containing", 1, 28],
      ["touching the first day", 1, 10],
      ["touching the last day", 20, 25],
    ])("detects %s", async (_label, from, to) => {
      const clash = await leaveRepository.findOverlapping(
        alphaScope,
        requester,
        day(2027, 2, from),
        day(2027, 2, to),
      );
      expect(clash).not.toBeNull();
    });

    it.each([
      ["strictly before", 1, 9],
      ["strictly after", 21, 28],
    ])("allows a range %s", async (_label, from, to) => {
      const clash = await leaveRepository.findOverlapping(
        alphaScope,
        requester,
        day(2027, 2, from),
        day(2027, 2, to),
      );
      expect(clash).toBeNull();
    });

    it("ignores cancelled and declined requests", async () => {
      await sqlTestPool().query(`UPDATE leaves SET status = 'CANCELLED' WHERE employee_id = $1`, [
        requester,
      ]);

      const clash = await leaveRepository.findOverlapping(
        alphaScope,
        requester,
        day(2027, 2, 12),
        day(2027, 2, 15),
      );
      expect(clash).toBeNull();
    });

    it("does not see another employee's leave", async () => {
      const other = await insertEmployee(alpha, "OTH1");
      const clash = await leaveRepository.findOverlapping(
        alphaScope,
        other,
        day(2027, 2, 12),
        day(2027, 2, 15),
      );
      expect(clash).toBeNull();
    });
  });

  describe("review", () => {
    it("records a decision once and refuses the second", async () => {
      const created = await request(1, 3, 3);

      const first = await leaveRepository.review(alphaScope, created.id, {
        status: "APPROVED",
        reviewerId: reviewer,
        reviewNote: "fine",
      });
      const second = await leaveRepository.review(alphaScope, created.id, {
        status: "REJECTED",
        reviewerId: reviewer,
      });

      expect(first).toBe(true);
      expect(second).toBe(false);

      const after = await leaveRepository.requireById(alphaScope, created.id);
      expect(after.status).toBe("APPROVED");
      expect(after.reviewer?.id).toBe(reviewer);
      expect(after.reviewedAt).not.toBeNull();
    });

    it("refuses a decision from another tenant", async () => {
      const created = await request(1, 3, 3);
      expect(
        await leaveRepository.review(betaScope, created.id, {
          status: "APPROVED",
          reviewerId: reviewer,
        }),
      ).toBe(false);
    });
  });

  describe("cancel", () => {
    it("withdraws the requester's own pending request", async () => {
      const created = await request(1, 3, 3);
      expect(await leaveRepository.cancelPending(alphaScope, created.id, requester)).toBe(true);
      expect((await leaveRepository.requireById(alphaScope, created.id)).status).toBe("CANCELLED");
    });

    it("refuses to withdraw someone else's request", async () => {
      const created = await request(1, 3, 3);
      expect(await leaveRepository.cancelPending(alphaScope, created.id, reviewer)).toBe(false);
    });

    it("refuses to withdraw a request already decided", async () => {
      const created = await request(1, 3, 3);
      await leaveRepository.review(alphaScope, created.id, {
        status: "APPROVED",
        reviewerId: reviewer,
      });
      expect(await leaveRepository.cancelPending(alphaScope, created.id, requester)).toBe(false);
    });
  });

  describe("balances", () => {
    it("sums only approved leave, per type, from the given date", async () => {
      const approved = await request(1, 2, 2);
      await leaveRepository.review(alphaScope, approved.id, {
        status: "APPROVED",
        reviewerId: reviewer,
      });

      // Pending, so it must not count against the balance.
      await request(10, 11, 2);

      const taken = await leaveRepository.takenByType(alphaScope, requester, day(2027, 0, 1));
      expect(taken.get("CASUAL")).toBe(2);
      expect(taken.get("SICK")).toBeUndefined();
    });
  });

  describe("tenant isolation", () => {
    it("hides a request from another organisation", async () => {
      const created = await request(1, 3, 3);
      expect(await leaveRepository.findById(betaScope, created.id)).toBeNull();
    });

    it("returns nothing for an empty visibility envelope", async () => {
      await request(1, 3, 3);

      // An empty envelope means "this caller can see nobody" and must not be
      // treated the same as null, which means "no restriction".
      const visible = await leaveRepository.listForReview(alphaScope, { employeeIds: [] });
      expect(visible).toHaveLength(0);

      const unrestricted = await leaveRepository.listForReview(alphaScope, { employeeIds: null });
      expect(unrestricted).toHaveLength(1);
    });

    it("excludes the reviewer's own request from their queue", async () => {
      await request(1, 3, 3);

      const queue = await leaveRepository.listForReview(alphaScope, {
        employeeIds: null,
        excludeEmployeeId: requester,
      });
      expect(queue).toHaveLength(0);
    });
  });
});
