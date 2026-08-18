import "server-only";

import type { AuthSession } from "@/server/auth/types";
import { errors } from "@/lib/errors";
import { isOrgWideRole } from "@/server/auth/permissions";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { teamRepository } from "@/server/repositories/org-repository";
import type { TenantScope } from "@/server/db/tenant";

/**
 * Visibility scoping.
 *
 * Answers one question: *which employees may this session see data about?*
 * Every list endpoint that returns per-person data (tasks, attendance,
 * reports) resolves its envelope here and passes it to the repository, so the
 * rule lives in one place instead of being re-derived per route.
 *
 *   OWNER / ADMIN / HR → the whole organisation  (`null` = no restriction)
 *   MANAGER            → themselves + their report tree + their teams' members
 *   EMPLOYEE           → themselves only
 */

/** `null` means "unrestricted within the tenant". */
export type VisibilityEnvelope = readonly string[] | null;

export function tenantScopeFor(session: AuthSession): TenantScope {
  return { organizationId: session.organization.id };
}

export async function resolveVisibleEmployeeIds(session: AuthSession): Promise<VisibilityEnvelope> {
  if (isOrgWideRole(session.user.role)) return null;

  const employee = session.employee;
  if (!employee) {
    // A non-org-wide account with no employee profile can see nothing.
    return [];
  }

  const scope = tenantScopeFor(session);
  const visible = new Set<string>([employee.id]);

  if (session.user.role === "MANAGER") {
    const [reportIds, teams] = await Promise.all([
      employeeRepository.listReportIds(scope, employee.id),
      teamRepository.listForEmployee(scope, employee.id),
    ]);

    reportIds.forEach((id) => visible.add(id));
    for (const team of teams) {
      // Only teams this person actually manages widen their view; simply being
      // a member of a team does not grant visibility of its other members.
      if (team.manager?.id === employee.id) {
        team.members.forEach((member) => visible.add(member.employee.id));
      }
    }
  }

  return Array.from(visible);
}

/** Throw unless the session may read data about `employeeId`. */
export async function assertCanViewEmployee(session: AuthSession, employeeId: string): Promise<void> {
  const envelope = await resolveVisibleEmployeeIds(session);
  if (envelope === null) return;
  if (!envelope.includes(employeeId)) {
    // 404 rather than 403 — see the note in repositories/tenant.ts.
    throw errors.notFound("employee");
  }
}

/**
 * Narrow a requested scope to what the session is actually allowed.
 * A client asking for "organization" as an EMPLOYEE silently gets "self",
 * never an error and never someone else's data.
 */
export async function narrowScope(
  session: AuthSession,
  requested: "self" | "team" | "organization",
): Promise<VisibilityEnvelope> {
  const employee = session.employee;

  if (requested === "self") {
    return employee ? [employee.id] : [];
  }

  const envelope = await resolveVisibleEmployeeIds(session);

  if (requested === "organization") {
    return envelope; // already null for org-wide roles, restricted otherwise
  }

  // "team": org-wide roles keep full visibility; everyone else keeps theirs.
  return envelope;
}

/** True when the session may act on the given employee's records. */
export function isSelf(session: AuthSession, employeeId: string): boolean {
  return session.employee?.id === employeeId;
}
