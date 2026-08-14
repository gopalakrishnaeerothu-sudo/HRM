import "server-only";

import type { PoolClient, QueryResultRow } from "pg";

import { pool } from "@/server/db/client";

/**
 * Query helpers.
 *
 * ─── The one rule ───────────────────────────────────────────────────────────
 * Every value that came from outside the server is passed as a parameter,
 * never interpolated into SQL. The signature enforces it: `sql` is a plain
 * string written by a developer, `params` is where data goes.
 *
 *     query('SELECT * FROM employees WHERE id = $1', [id])      // correct
 *     query(`SELECT * FROM employees WHERE id = '${id}'`)       // never
 *
 * The second form is what SQL injection is. There is no helper here that
 * accepts interpolated values, so the wrong thing has to be written
 * deliberately rather than reached for by accident.
 *
 * ─── Identifiers ────────────────────────────────────────────────────────────
 * Parameters cannot stand in for table or column names. Where a query needs a
 * dynamic column — a sort order, say — the value must be checked against an
 * allow-list of known columns. `sortDirection` and `assertIdentifier` below
 * exist for that; nothing should build an identifier from user input any other
 * way.
 */

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export type Executor = Queryable;

/** The default executor. Repositories accept one so they can join a transaction. */
export function db(): Executor {
  return pool as unknown as Executor;
}

/** Run a query and return all rows. */
export async function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = db(),
): Promise<R[]> {
  const result = await executor.query<R>(sql, params);
  return result.rows;
}

/** Run a query expected to return at most one row. */
export async function queryOne<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = db(),
): Promise<R | null> {
  const rows = await query<R>(sql, params, executor);
  return rows[0] ?? null;
}

/**
 * Run a query that must return exactly one row.
 * Throws when it does not — for INSERT … RETURNING, where zero rows means the
 * write silently did nothing.
 */
export async function queryExactlyOne<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = db(),
): Promise<R> {
  const rows = await query<R>(sql, params, executor);

  if (rows.length !== 1) {
    // Deliberately does not include the SQL or parameters: this message can
    // reach a log, and parameters carry user data.
    throw new Error(`Expected exactly one row, received ${rows.length}`);
  }
  return rows[0];
}

/** Run a statement and return how many rows it affected. */
export async function execute(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = db(),
): Promise<number> {
  const result = await executor.query(sql, params);
  return result.rowCount ?? 0;
}

/** `SELECT count(*)` as a number. */
export async function count(
  sql: string,
  params: readonly unknown[] = [],
  executor: Executor = db(),
): Promise<number> {
  const row = await queryOne<{ count: string | number }>(sql, params, executor);
  if (!row) return 0;
  return typeof row.count === "number" ? row.count : Number.parseInt(row.count, 10);
}

// ---------------------------------------------------------------------------
// Safe dynamic SQL
// ---------------------------------------------------------------------------

/**
 * Incremental WHERE builder.
 *
 * Collects conditions and their parameters together, so the placeholder
 * numbering can never drift out of step with the values — the bug that makes
 * hand-built dynamic SQL both wrong and dangerous.
 *
 *     const where = new WhereBuilder();
 *     where.add('organization_id = $', organizationId);
 *     if (status) where.add('status = $', status);
 *     query(`SELECT * FROM employees ${where.clause()}`, where.params());
 *
 * Each `$` in the fragment is replaced with the next positional placeholder.
 */
export class WhereBuilder {
  private conditions: string[] = [];
  private values: unknown[] = [];

  /** Add a condition. Every `$` becomes the next placeholder, in order. */
  add(fragment: string, ...params: unknown[]): this {
    let index = 0;
    const rendered = fragment.replace(/\$(?!\d)/g, () => {
      this.values.push(params[index]);
      index += 1;
      return `$${this.values.length}`;
    });

    if (index !== params.length) {
      throw new Error(
        `WhereBuilder: fragment has ${index} placeholders but ${params.length} parameters were supplied`,
      );
    }

    this.conditions.push(rendered);
    return this;
  }

  /** Add a condition only when `condition` is true. */
  addIf(condition: boolean, fragment: string, ...params: unknown[]): this {
    if (condition) this.add(fragment, ...params);
    return this;
  }

  /** `WHERE a AND b`, or an empty string when nothing was added. */
  clause(): string {
    return this.conditions.length === 0 ? "" : `WHERE ${this.conditions.join(" AND ")}`;
  }

  params(): unknown[] {
    return this.values;
  }

  /** Next placeholder number, for appending LIMIT/OFFSET after the clause. */
  nextIndex(): number {
    return this.values.length + 1;
  }

  /** Register extra values (LIMIT, OFFSET) so numbering stays consistent. */
  push(...params: unknown[]): this {
    this.values.push(...params);
    return this;
  }
}

/**
 * Validate an identifier against an allow-list.
 *
 * Used for sort columns, which cannot be parameterised. Anything not on the
 * list is rejected rather than escaped — if a caller asks to sort by a column
 * that is not offered, that is a bug or an attack, and neither deserves a
 * best-effort interpretation.
 */
export function assertIdentifier<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Normalise a sort direction to a literal. Never interpolate raw input here. */
export function sortDirection(value: string | undefined): "ASC" | "DESC" {
  return value?.toLowerCase() === "desc" ? "DESC" : "ASC";
}

/**
 * Build a `LIKE`/`ILIKE` pattern for a substring search.
 *
 * Parameterising a value protects against SQL injection — it can never become
 * SQL. It does NOT stop `%` and `_` inside that value from being interpreted
 * as wildcards by `LIKE` itself, because at that point they are part of the
 * pattern, not part of the statement.
 *
 * Left alone, a user typing `%` matches every row, and `_` matches any single
 * character. That is not a security hole, but it is wrong: the search box
 * should look for the characters someone typed.
 *
 * The metacharacters are therefore escaped with a backslash, which callers
 * pair with `ESCAPE '\'` on the comparison.
 */
export function likePattern(term: string): string {
  const escaped = term
    // Backslash first, or it would double-escape the ones added below.
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");

  return `%${escaped}%`;
}

export type { PoolClient };
