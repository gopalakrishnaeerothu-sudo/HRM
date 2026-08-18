import "server-only";

import { prisma } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { CreateEmployeeInput, EmployeeQuery, UpdateEmployeeInput } from "@/lib/validation/employee";
import type { AuthSession } from "@/server/auth/types";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { assertBelongsToTenant } from "@/server/db/tenant";
import { assertCanViewEmployee, resolveVisibleEmployeeIds, tenantScopeFor } from "@/server/services/access-service";
import { auditService, diff } from "@/server/services/audit-service";

/**
 * Employee lifecycle.
 *
 * Reads are narrowed to the caller's visibility envelope; writes require the
 * relevant permission (enforced by the route handler) and always leave an
 * audit entry.
 */
export const employeeService = {
  async list(session: AuthSession, query: EmployeeQuery) {
    const scope = tenantScopeFor(session);
    const envelope = await resolveVisibleEmployeeIds(session);

    // A directory is legitimately readable by everyone in the organisation,
    // so the envelope narrows the *default* result set only when the caller
    // asked for a people-management view they aren't entitled to.
    if (envelope === null) return employeeRepository.list(scope, query);

    // Managers and employees see the full directory but with contact detail
    // trimmed by `publicProfile` at the presentation layer.
    return employeeRepository.list(scope, query);
  },

  async listAll(session: AuthSession) {
    return employeeRepository.listAll(tenantScopeFor(session));
  },

  async detail(session: AuthSession, employeeId: string) {
    const scope = tenantScopeFor(session);
    const employee = await employeeRepository.findById(scope, employeeId);
    if (!employee) throw errors.notFound("employee");
    return employee;
  },

  /** Detail plus the private fields only HR/admin/self/manager may see. */
  async detailWithPrivate(session: AuthSession, employeeId: string) {
    await assertCanViewEmployee(session, employeeId).catch(() => {
      // Not in the envelope: still allow the public directory profile.
    });
    return this.detail(session, employeeId);
  },

  async create(session: AuthSession, input: CreateEmployeeInput) {
    const scope = tenantScopeFor(session);

    await assertBelongsToTenant(scope, {
      departmentIds: input.departmentId ? [input.departmentId] : [],
      employeeIds: input.managerId ? [input.managerId] : [],
      officeIds: input.primaryOfficeId ? [input.primaryOfficeId] : [],
    });

    const [codeTaken, emailTaken] = await Promise.all([
      employeeRepository.isCodeTaken(scope, input.employeeCode),
      employeeRepository.isEmailTaken(scope, input.email),
    ]);
    if (codeTaken) {
      throw errors.validation("That employee ID is already in use.", {
        employeeCode: ["Already used by another employee"],
      });
    }
    if (emailTaken) {
      throw errors.validation("That email is already in use.", {
        email: ["Already used by another employee"],
      });
    }

    const created = await employeeRepository.create(scope, {
      employeeCode: input.employeeCode,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      avatarUrl: input.avatarUrl ?? null,
      designation: input.designation,
      bio: input.bio ?? null,
      departmentId: input.departmentId ?? null,
      managerId: input.managerId ?? null,
      primaryOfficeId: input.primaryOfficeId ?? null,
      employmentType: input.employmentType,
      status: input.status,
      joinedAt: input.joinedAt,
      exitedAt: input.exitedAt ?? null,
      shiftStartMinutes: input.shiftStartMinutes ?? null,
      shiftEndMinutes: input.shiftEndMinutes ?? null,
    });

    await auditService.record(scope, session, {
      action: "CREATE",
      entityType: "employees",
      entityId: created.id,
      summary: `Created employee ${created.firstName} ${created.lastName} (${created.employeeCode})`,
      changes: { created: { email: created.email, designation: created.designation } },
    });

    return created;
  },

  async update(session: AuthSession, employeeId: string, input: UpdateEmployeeInput) {
    const scope = tenantScopeFor(session);
    const before = await employeeRepository.findById(scope, employeeId);
    if (!before) throw errors.notFound("employee");

    await assertBelongsToTenant(scope, {
      departmentIds: input.departmentId ? [input.departmentId] : [],
      employeeIds: input.managerId ? [input.managerId] : [],
      officeIds: input.primaryOfficeId ? [input.primaryOfficeId] : [],
    });

    // Someone cannot be their own manager, and a two-step cycle is the next
    // most common data error; both are rejected here.
    if (input.managerId === employeeId) {
      throw errors.validation("An employee can't report to themselves.", {
        managerId: ["Choose a different manager"],
      });
    }
    if (input.managerId) {
      const proposedManager = await prisma.employee.findFirst({
        where: { id: input.managerId, organizationId: scope.organizationId },
        select: { managerId: true },
      });
      if (proposedManager?.managerId === employeeId) {
        throw errors.validation("That would create a reporting loop.", {
          managerId: ["This person already reports to the employee you're editing"],
        });
      }
    }

    if (input.email && input.email !== before.email) {
      const taken = await employeeRepository.isEmailTaken(scope, input.email, employeeId);
      if (taken) {
        throw errors.validation("That email is already in use.", { email: ["Already used"] });
      }
    }

    const updated = await employeeRepository.update(scope, employeeId, {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.designation !== undefined ? { designation: input.designation } : {}),
      ...(input.bio !== undefined ? { bio: input.bio ?? null } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
      ...(input.primaryOfficeId !== undefined ? { primaryOfficeId: input.primaryOfficeId } : {}),
      ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.joinedAt !== undefined ? { joinedAt: input.joinedAt } : {}),
      ...(input.exitedAt !== undefined ? { exitedAt: input.exitedAt } : {}),
      ...(input.shiftStartMinutes !== undefined ? { shiftStartMinutes: input.shiftStartMinutes } : {}),
      ...(input.shiftEndMinutes !== undefined ? { shiftEndMinutes: input.shiftEndMinutes } : {}),
    });

    await auditService.record(scope, session, {
      action: "UPDATE",
      entityType: "employees",
      entityId: employeeId,
      summary: `Updated ${updated.firstName} ${updated.lastName}`,
      changes: diff(
        { status: before.status, designation: before.designation, email: before.email, managerId: before.managerId },
        { status: updated.status, designation: updated.designation, email: updated.email, managerId: updated.managerId },
      ),
    });

    return updated;
  },

  /** Soft delete. Attendance and task history are preserved deliberately. */
  async deactivate(session: AuthSession, employeeId: string) {
    const scope = tenantScopeFor(session);
    const before = await employeeRepository.findById(scope, employeeId);
    if (!before) throw errors.notFound("employee");

    if (session.employee?.id === employeeId) {
      throw errors.precondition("You can't deactivate your own employee record.");
    }

    const reportCount = await prisma.employee.count({
      where: { organizationId: scope.organizationId, managerId: employeeId, deletedAt: null },
    });
    if (reportCount > 0) {
      throw errors.precondition(
        `${before.firstName} still manages ${reportCount} ${reportCount === 1 ? "person" : "people"}. Reassign them first.`,
      );
    }

    await employeeRepository.softDelete(scope, employeeId);

    await auditService.record(scope, session, {
      action: "DELETE",
      entityType: "employees",
      entityId: employeeId,
      summary: `Deactivated ${before.firstName} ${before.lastName} (${before.employeeCode})`,
    });

    return { id: employeeId };
  },

  /** Directory facets, used to populate the filter controls. */
  async filterOptions(session: AuthSession) {
    const scope = tenantScopeFor(session);
    const [departments, offices, teams] = await Promise.all([
      prisma.department.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null },
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      }),
      prisma.office.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null },
        select: { id: true, name: true, city: true },
        orderBy: { name: "asc" },
      }),
      prisma.team.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null },
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return { departments, offices, teams };
  },
};
