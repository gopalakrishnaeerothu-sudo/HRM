import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { query, queryOne } from "@/server/db/query";
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

    // Deliberately not tenant-scoped: this endpoint exists to switch between
    // demo accounts across organisations, and `guard()` above restricts it to
    // development. It must never be reachable in production.
    const rows = await query<{
      id: string;
      name: string;
      email: string;
      role: string;
      avatar_url: string | null;
      organization_name: string;
      organization_slug: string;
      designation: string | null;
      employee_code: string | null;
    }>(
      `SELECT u.id, u.name, u.email, u.role, u.avatar_url,
              o.name AS organization_name, o.slug AS organization_slug,
              e.designation, e.employee_code
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
         LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
        WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
        ORDER BY u.role ASC, u.name ASC
        LIMIT 60`,
    );

    const users = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatar_url,
      organization: { name: row.organization_name, slug: row.organization_slug },
      employee: row.employee_code
        ? { designation: row.designation, employeeCode: row.employee_code }
        : null,
    }));

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

    const user = await queryOne<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM users
        WHERE id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'`,
      [parsed.data.userId],
    );
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
