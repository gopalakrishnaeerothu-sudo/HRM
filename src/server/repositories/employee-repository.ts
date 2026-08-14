import "server-only";

import type { Prisma } from "@prisma/client";

import type { EmployeeQuery } from "@/lib/validation/employee";
import {
  assertFound,
  client,
  liveTenantWhere,
  paginate,
  skipTake,
  type Paginated,
  type TenantScope,
} from "@/server/repositories/tenant";

/**
 * Employee reads and writes. All queries are tenant-scoped by construction —
 * see `src/server/repositories/tenant.ts`.
 */

/** Columns needed to render an employee in a list or card. */
export const employeeSummarySelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatarUrl: true,
  designation: true,
  status: true,
  employmentType: true,
  joinedAt: true,
  departmentId: true,
  managerId: true,
  primaryOfficeId: true,
  department: { select: { id: true, name: true, color: true, code: true } },
  primaryOffice: { select: { id: true, name: true, city: true } },
  manager: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  user: { select: { id: true, role: true, status: true } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeSummary = Prisma.EmployeeGetPayload<{ select: typeof employeeSummarySelect }>;

const employeeDetailSelect = {
  ...employeeSummarySelect,
  bio: true,
  exitedAt: true,
  shiftStartMinutes: true,
  shiftEndMinutes: true,
  createdAt: true,
  updatedAt: true,
  reports: {
    where: { deletedAt: null },
    select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: true },
    orderBy: { firstName: "asc" },
  },
  teamMemberships: {
    select: {
      roleLabel: true,
      team: { select: { id: true, name: true, slug: true, color: true } },
    },
  },
  officeAccess: {
    select: { office: { select: { id: true, name: true, city: true } } },
  },
} satisfies Prisma.EmployeeSelect;

export type EmployeeDetail = Prisma.EmployeeGetPayload<{ select: typeof employeeDetailSelect }>;

function buildWhere(scope: TenantScope, query: Partial<EmployeeQuery>): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { ...liveTenantWhere(scope) };

  if (query.status) where.status = query.status;
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.officeId) where.primaryOfficeId = query.officeId;
  if (query.managerId) where.managerId = query.managerId;
  if (query.employmentType) where.employmentType = query.employmentType;
  if (query.teamId) where.teamMemberships = { some: { teamId: query.teamId } };

  if (query.search) {
    const term = query.search;
    where.OR = [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { employeeCode: { contains: term, mode: "insensitive" } },
      { designation: { contains: term, mode: "insensitive" } },
    ];
  }

  return where;
}

function buildOrderBy(query: Partial<EmployeeQuery>): Prisma.EmployeeOrderByWithRelationInput[] {
  const direction = query.sortOrder ?? "asc";
  switch (query.sortBy) {
    case "joinedAt":
      return [{ joinedAt: direction }, { firstName: "asc" }];
    case "designation":
      return [{ designation: direction }, { firstName: "asc" }];
    case "department":
      return [{ department: { name: direction } }, { firstName: "asc" }];
    default:
      return [{ firstName: direction }, { lastName: direction }];
  }
}

export const employeeRepository = {
  async list(scope: TenantScope, query: EmployeeQuery): Promise<Paginated<EmployeeSummary>> {
    const db = client(scope);
    const where = buildWhere(scope, query);

    const [items, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: employeeSummarySelect,
        orderBy: buildOrderBy(query),
        ...skipTake(query.page, query.pageSize),
      }),
      db.employee.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  },

  /** Every employee in the tenant, for pickers and org charts. */
  async listAll(scope: TenantScope, activeOnly = true): Promise<EmployeeSummary[]> {
    return client(scope).employee.findMany({
      where: { ...liveTenantWhere(scope), ...(activeOnly ? { status: "ACTIVE" } : {}) },
      select: employeeSummarySelect,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
  },

  async findById(scope: TenantScope, id: string): Promise<EmployeeDetail | null> {
    return client(scope).employee.findFirst({
      where: { id, ...liveTenantWhere(scope) },
      select: employeeDetailSelect,
    });
  },

  async requireById(scope: TenantScope, id: string): Promise<EmployeeDetail> {
    return assertFound(await this.findById(scope, id), "employee");
  },

  /** Direct reports plus, transitively, their reports — a manager's full tree. */
  async listReportIds(scope: TenantScope, managerId: string): Promise<string[]> {
    const db = client(scope);
    const collected = new Set<string>();
    let frontier = [managerId];

    // Bounded loop: an org chart deeper than 10 levels is a data error, and
    // stopping there prevents a cycle from hanging the request.
    for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
      const rows: Array<{ id: string }> = await db.employee.findMany({
        where: { ...liveTenantWhere(scope), managerId: { in: frontier } },
        select: { id: true },
      });
      const next = rows.map((row) => row.id).filter((id) => !collected.has(id));
      next.forEach((id) => collected.add(id));
      frontier = next;
    }

    return Array.from(collected);
  },

  async create(scope: TenantScope, data: Prisma.EmployeeUncheckedCreateInput) {
    return client(scope).employee.create({
      data: { ...data, organizationId: scope.organizationId },
      select: employeeSummarySelect,
    });
  },

  async update(scope: TenantScope, id: string, data: Prisma.EmployeeUpdateInput) {
    // updateMany applies the tenant filter; a cross-tenant id updates 0 rows.
    const result = await client(scope).employee.updateMany({
      where: { id, ...liveTenantWhere(scope) },
      data: data as Prisma.EmployeeUpdateManyMutationInput,
    });
    if (result.count === 0) throw new Error("NOT_FOUND_IN_SCOPE");
    return this.requireById(scope, id);
  },

  /** Soft delete: the row stays for audit and historical attendance. */
  async softDelete(scope: TenantScope, id: string): Promise<boolean> {
    const result = await client(scope).employee.updateMany({
      where: { id, ...liveTenantWhere(scope) },
      data: { deletedAt: new Date(), status: "INACTIVE" },
    });
    return result.count > 0;
  },

  async countByStatus(scope: TenantScope) {
    const rows = await client(scope).employee.groupBy({
      by: ["status"],
      where: liveTenantWhere(scope),
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  },

  async countByDepartment(scope: TenantScope) {
    const rows = await client(scope).employee.groupBy({
      by: ["departmentId"],
      where: { ...liveTenantWhere(scope), status: "ACTIVE" },
      _count: { _all: true },
    });

    const departments = await client(scope).department.findMany({
      where: liveTenantWhere(scope),
      select: { id: true, name: true, color: true },
    });
    const byId = new Map(departments.map((department) => [department.id, department]));

    return rows.map((row) => ({
      departmentId: row.departmentId,
      name: row.departmentId ? (byId.get(row.departmentId)?.name ?? "Unassigned") : "Unassigned",
      color: row.departmentId ? (byId.get(row.departmentId)?.color ?? "#94a3b8") : "#94a3b8",
      count: row._count._all,
    }));
  },

  async isCodeTaken(scope: TenantScope, employeeCode: string, exceptId?: string): Promise<boolean> {
    const found = await client(scope).employee.findFirst({
      where: {
        organizationId: scope.organizationId,
        employeeCode,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  },

  async isEmailTaken(scope: TenantScope, email: string, exceptId?: string): Promise<boolean> {
    const found = await client(scope).employee.findFirst({
      where: {
        organizationId: scope.organizationId,
        email,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  },
};
