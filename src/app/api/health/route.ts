import { NextResponse } from "next/server";

import { queryOne } from "@/server/db/query";

/**
 * Health check for the platform.
 *
 * Verifies the process is up *and* that it can reach PostgreSQL *and* that the
 * schema it expects is actually there. The last part is not pedantry: a
 * `SELECT 1` passes against a database with no tables at all, so an instance
 * pointed at an unmigrated database reports itself healthy while every page
 * fails. Touching a real table makes the check mean what it says.
 *
 * Returns 503 on failure so the platform replaces it.
 *
 * Deliberately says nothing about the database beyond up/down — no version, no
 * host, no connection string, no row counts.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  try {
    // `to_regclass` returns NULL rather than raising when the table is absent,
    // so a missing schema is a clean 503 instead of an unhandled error.
    const row = await queryOne<{ migrated: boolean }>(
      `SELECT to_regclass('public.organizations') IS NOT NULL AS migrated`,
    );

    if (!row?.migrated) {
      return NextResponse.json(
        { status: "degraded", reason: "schema_not_migrated", timestamp: new Date().toISOString() },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        databaseLatencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health] database unreachable", error);

    return NextResponse.json(
      { status: "degraded", reason: "database_unreachable", timestamp: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
