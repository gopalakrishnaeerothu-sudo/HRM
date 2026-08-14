import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { isProduction, serverEnv } from "@/lib/env";
import { errors, toPublicError } from "@/lib/errors";
import { SESSION_COOKIE } from "@/server/auth/types";

/**
 * DEVELOPMENT-ONLY role switcher.
 *
 * Lets you view the app as any seeded user without a password, so the four
 * role experiences can be demonstrated before real authentication exists.
 *
 * It is fenced twice: `guard()` refuses when NODE_ENV is production, and again
 * when DEV_AUTH_ENABLED is not "true". Deploying with the flag left on still
 * gets a 404 in production. Nothing under /api/dev is reachable there.
 *
 * When a real AuthAdapter is registered, delete this folder — no other code
 * imports it.
 */

function guard(): void {
  if (isProduction || !serverEnv().DEV_AUTH_ENABLED) {
    throw errors.notFound("route");
  }
}

/** GET — list the accounts available to impersonate, one per role. */
export async function GET() {
  try {
    guard();

    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        organization: { select: { name: true, slug: true } },
        employee: { select: { designation: true, employeeCode: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      take: 60,
    });

    return NextResponse.json({ data: users }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}

const switchSchema = z.object({ userId: z.string().uuid() });

/** POST — switch the active demo user. */
export async function POST(request: Request) {
  try {
    guard();

    const parsed = switchSchema.safeParse(await request.json());
    if (!parsed.success) throw errors.validation("Pick a user to view the app as.");

    const user = await prisma.user.findFirst({
      where: { id: parsed.data.userId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true, role: true },
    });
    if (!user) throw errors.notFound("user");

    const store = await cookies();
    store.set(SESSION_COOKIE, user.id, {
      httpOnly: true,
      sameSite: "lax",
      // Not `secure`, because this only ever runs over http://localhost.
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    return NextResponse.json(
      { data: { id: user.id, name: user.name, role: user.role } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status });
  }
}
