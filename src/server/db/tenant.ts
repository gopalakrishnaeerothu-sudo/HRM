import "server-only";

import { errors } from "@/lib/errors";
import { count, db, query, type Executor } from "@/server/db/query";

/**
 * Tenant scoping for the SQL repository layer.
 *
 * Every repository function takes a `TenantScope` and puts `organization_id`
 * into the WHERE clause of every statement. That is the mechanism keeping
 * organisations apart — not a filter in the UI, and not a check in a route
 * handler that someone can forget to write.
 *
 * The rule, stated once:
 *
 *   A repository never accepts a bare id from the client and returns a row.
 *   It accepts a scope plus an id, and returns a row only if that row belongs
 *   to that scope.
 *
 * Cross-tenant misses surface as 404, never 403. A 403 would confirm the id
 * exists in some other organisation, which is enough to enumerate another
 * tenant's id space by watching status codes.
 */

export interface TenantScope {
  organizationId: string;
  /** Present when the caller is inside a transaction; repositories join it. */
  tx?: Executor;
}

/** Resolve the executor a repository should use. */
export function exec(scope: TenantScope): Executor {
  return scope.tx ?? db();
}

/** Assert a row was found within the scope. Use at every id-based read. */
export function assertFound<T>(record: T | null | undefined, what: string): T {
  if (record === null || record === undefined) throw errors.notFound(what);
  return record;
}

/**
 * Confirm that ids supplied in a request body reference rows inside this
 * tenant, before they are written as foreign keys.
 *
 * A foreign key alone is not enough: `employees.manager_id` references
 * `employees`, so pointing it at another organisation's employee would satisfy
 * the constraint while quietly linking two tenants together.
 *
 * One query per table, using `= ANY($1)` so the id list is a single parameter
 * rather than a generated placeholder list.
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
  const executor = exec(scope);

  const checks: Array<Promise<void>> = [];

  const verify = (
    ids: readonly string[] | undefined,
    table: "employees" | "offices" | "teams" | "departments",
    label: string,
  ) => {
    if (!ids || ids.length === 0) return;
    const unique = Array.from(new Set(ids));

    checks.push(
      (async () => {
        // Table name is a literal from the union above, never user input.
        const found = await count(
          `SELECT count(*) FROM ${table}
            WHERE id = ANY($1::uuid[])
              AND organization_id = $2
              AND deleted_at IS NULL`,
          [unique, scope.organizationId],
          executor,
        );

        if (found !== unique.length) throw errors.notFound(label);
      })(),
    );
  };

  verify(refs.employeeIds, "employees", "employee");
  verify(refs.officeIds, "offices", "office");
  verify(refs.teamIds, "teams", "team");
  verify(refs.departmentIds, "departments", "department");

  await Promise.all(checks);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** The envelope every list repository returns. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return {
    items,
    total,
    page,
    pageSize,
    pageCount,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}

/** LIMIT/OFFSET for a 1-based page number. */
export function limitOffset(page: number, pageSize: number): { limit: number; offset: number } {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  // Capped so a client cannot request the whole table in one round trip.
  const safeSize = Math.min(200, Math.max(1, Math.trunc(pageSize) || 25));

  return { limit: safeSize, offset: (safePage - 1) * safeSize };
}

/**
 * Run a list query and its COUNT together.
 *
 * Both statements take the same WHERE clause and the same parameters, which is
 * what keeps `total` honest: computing the count from a differently-filtered
 * query is how paginators end up reporting a page count that does not match
 * the rows on screen.
 */
export async function paginatedQuery<R extends Record<string, unknown>>(
  options: {
    select: string;
    from: string;
    where: string;
    orderBy: string;
    params: readonly unknown[];
    page: number;
    pageSize: number;
    /** Distinct column for COUNT when the FROM contains a fan-out join. */
    countExpression?: string;
  },
  executor: Executor = db(),
): Promise<Paginated<R>> {
  const { limit, offset } = limitOffset(options.page, options.pageSize);
  const params = [...options.params];

  const rowsPromise = query<R>(
    `SELECT ${options.select}
       FROM ${options.from}
       ${options.where}
       ORDER BY ${options.orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
    executor,
  );

  const totalPromise = count(
    `SELECT count(${options.countExpression ?? "*"})
       FROM ${options.from}
       ${options.where}`,
    params,
    executor,
  );

  const [items, total] = await Promise.all([rowsPromise, totalPromise]);

  return paginate(items, total, Math.max(1, options.page), limit);
}
