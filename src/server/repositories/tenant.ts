import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { errors } from "@/lib/errors";

/**
 * Tenant scoping.
 *
 * Every repository function in this folder takes a `TenantScope` as its first
 * argument and folds `organizationId` into the `where` clause of every query.
 * That is the mechanism that keeps organisations apart — not a filter in the
 * UI, and not a check in a route handler that someone can forget.
 *
 * The rule, stated once:
 *
 *   A repository never accepts a bare id from the client and returns a row.
 *   It accepts a scope plus an id, and returns a row only if that row belongs
 *   to that scope.
 *
 * Cross-tenant misses surface as 404, never 403 — a 403 would confirm that the
 * id exists in some other organisation.
 *
 * Defence in depth: `docs/ARCHITECTURE.md` describes the optional PostgreSQL
 * Row Level Security policies that can be enabled on top of this, so that even
 * a repository bug cannot leak rows across tenants.
 */

export interface TenantScope {
  organizationId: string;
  /** Optional transaction client — repositories join an outer transaction. */
  db?: DbClient;
}

/** Resolve the client a repository should use. */
export function client(scope: TenantScope): DbClient {
  return scope.db ?? prisma;
}

/** `where` fragment applied to every tenant-owned query. */
export function tenantWhere(scope: TenantScope) {
  return { organizationId: scope.organizationId } as const;
}

/** Tenant filter plus the soft-delete filter, for tables that have one. */
export function liveTenantWhere(scope: TenantScope) {
  return { organizationId: scope.organizationId, deletedAt: null } as const;
}

/**
 * Assert that a record was found within the scope. Use at every read that
 * takes an id from the outside world.
 */
export function assertFound<T>(record: T | null | undefined, what: string): T {
  if (record === null || record === undefined) throw errors.notFound(what);
  return record;
}

/**
 * Guard for ids supplied in a request body that reference tenant-owned rows
 * (a manager id, a team id, an office id). Confirms every id exists inside the
 * scope before it is written as a foreign key.
 */
export async function assertBelongsToTenant(
  scope: TenantScope,
  refs: {
    employeeIds?: readonly string[];
    officeIds?: readonly string[];
    teamIds?: readonly string[];
    departmentIds?: readonly string[];
  },
): Promise<void> {
  const db = client(scope);
  const checks: Array<Promise<void>> = [];

  const verify = async (
    ids: readonly string[],
    count: (unique: string[]) => Promise<number>,
    label: string,
  ) => {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return;
    const found = await count(unique);
    if (found !== unique.length) throw errors.notFound(label);
  };

  if (refs.employeeIds?.length) {
    checks.push(
      verify(
        refs.employeeIds,
        (unique) =>
          db.employee.count({
            where: { id: { in: unique }, organizationId: scope.organizationId, deletedAt: null },
          }),
        "employee",
      ),
    );
  }
  if (refs.officeIds?.length) {
    checks.push(
      verify(
        refs.officeIds,
        (unique) =>
          db.office.count({
            where: { id: { in: unique }, organizationId: scope.organizationId, deletedAt: null },
          }),
        "office",
      ),
    );
  }
  if (refs.teamIds?.length) {
    checks.push(
      verify(
        refs.teamIds,
        (unique) =>
          db.team.count({
            where: { id: { in: unique }, organizationId: scope.organizationId, deletedAt: null },
          }),
        "team",
      ),
    );
  }
  if (refs.departmentIds?.length) {
    checks.push(
      verify(
        refs.departmentIds,
        (unique) =>
          db.department.count({
            where: { id: { in: unique }, organizationId: scope.organizationId, deletedAt: null },
          }),
        "department",
      ),
    );
  }

  await Promise.all(checks);
}

/** Standard paginated envelope returned by every list repository. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function skipTake(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
