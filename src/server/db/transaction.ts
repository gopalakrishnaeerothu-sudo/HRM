import "server-only";

import { pool } from "@/server/db/client";
import type { Executor } from "@/server/db/query";

/**
 * Transactions.
 *
 * `transaction()` takes a callback, hands it a dedicated client, and commits
 * if it returns or rolls back if it throws. The client is always released,
 * including on the rollback path — a leaked client is a permanently lost
 * connection, and enough of them stop the application.
 *
 *     await transaction(async (tx) => {
 *       const record = await upsertAttendanceRecord(scope, tx, …);
 *       await insertAttendanceEvent(scope, tx, { recordId: record.id, … });
 *     });
 *
 * The `tx` executor is passed down into repository calls so several writes
 * land atomically. Check-in is the motivating case: the attendance record and
 * its location event must both exist or neither must, otherwise there is a
 * check-in with no evidence, or evidence for a check-in that did not happen.
 */

export async function transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client as unknown as Executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // Rollback can itself fail if the connection died mid-transaction. Swallow
    // that so the original error — the useful one — is what propagates.
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run inside a SERIALIZABLE transaction.
 *
 * Reserved for the few places where a read informs a write that must not race:
 * allocating the next per-tenant task reference is the example. Postgres may
 * abort a serializable transaction with SQLSTATE 40001, which the caller is
 * expected to retry — `withRetry` below does that.
 */
export async function serializableTransaction<T>(
  callback: (tx: Executor) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await callback(client as unknown as Executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** PostgreSQL serialization failure and deadlock — both are retryable. */
const RETRYABLE_CODES = new Set(["40001", "40P01"]);

function isRetryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    RETRYABLE_CODES.has(String((error as { code: unknown }).code))
  );
}

/**
 * Retry a serialization failure with a short backoff.
 *
 * Only retries the codes above. Retrying a constraint violation would be
 * pointless — it will fail identically every time — and retrying an unknown
 * error risks repeating a side effect.
 */
export async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) throw error;

      // 10ms, 20ms, 40ms — enough to let the conflicting transaction finish.
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }

  throw lastError;
}
