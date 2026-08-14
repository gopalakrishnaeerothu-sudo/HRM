import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Health check for Railway.
 *
 * Verifies the process is up *and* that it can reach PostgreSQL, because a
 * container that answers HTTP but cannot query the database is not healthy in
 * any useful sense. Returns 503 on failure so the platform replaces it.
 *
 * Deliberately says nothing about the database beyond up/down — no version, no
 * host, no connection string. Configure this path in railway.json under
 * `healthcheckPath`.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

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
