import type { UserRole } from "@prisma/client";

/**
 * Role → capability map.
 *
 * This is the single place that decides what a role may do. UI components ask
 * the same functions the API routes do, so a hidden button and a rejected
 * request always agree — but the UI check is *cosmetic*; the server check in
 * `requirePermission` is the one that protects data.
 */

export const PERMISSIONS = [
  // People
  "employee:read",
  "employee:read:all",
  "employee:create",
  "employee:update",
  "employee:delete",
  // Teams & departments
  "team:read",
  "team:manage",
  "department:manage",
  // Tasks
  "task:read",
  "task:read:all",
  "task:create",
  "task:update:any",
  "task:delete",
  // Attendance
  "attendance:read:self",
  "attendance:read:team",
  "attendance:read:all",
  "attendance:check-in",
  "attendance:override",
  // Offices & geofences
  "office:read",
  "office:manage",
  "geofence:manage",
  // Leave
  "leave:request",
  "leave:approve",
  // Platform
  "report:read",
  "report:export",
  "settings:manage",
  "audit:read",
  "notification:broadcast",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE_PERMISSIONS: Permission[] = [
  "employee:read",
  "team:read",
  "task:read",
  "task:create",
  "attendance:read:self",
  "attendance:check-in",
  "office:read",
  "leave:request",
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  "task:read:all",
  "task:update:any",
  "attendance:read:team",
  "team:manage",
  "leave:approve",
  "report:read",
];

const HR_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  "employee:read:all",
  "employee:create",
  "employee:update",
  "department:manage",
  "attendance:read:all",
  "attendance:override",
  "report:export",
  "notification:broadcast",
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...HR_PERMISSIONS,
  "employee:delete",
  "task:delete",
  "office:manage",
  "geofence:manage",
  "settings:manage",
  "audit:read",
];

/** OWNER differs from ADMIN only in that it cannot be removed by an admin. */
const OWNER_PERMISSIONS: Permission[] = [...ADMIN_PERMISSIONS];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  HR: new Set(HR_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  EMPLOYEE: new Set(EMPLOYEE_PERMISSIONS),
};

/**
 * @param overrides per-tenant grants/revocations from the role_permissions
 *   table, applied on top of the defaults above.
 */
export function hasPermission(
  role: UserRole,
  permission: Permission,
  overrides?: ReadonlyMap<Permission, boolean>,
): boolean {
  const override = overrides?.get(permission);
  if (override !== undefined) return override;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function hasAnyPermission(
  role: UserRole,
  permissions: readonly Permission[],
  overrides?: ReadonlyMap<Permission, boolean>,
): boolean {
  return permissions.some((permission) => hasPermission(role, permission, overrides));
}

/** Roles that can see the whole organisation rather than just their own team. */
export function isOrgWideRole(role: UserRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "HR";
}

export function isManagerialRole(role: UserRole): boolean {
  return isOrgWideRole(role) || role === "MANAGER";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  HR: "HR",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  OWNER: "Full control of the organisation, including billing and ownership transfer.",
  ADMIN: "Full operational control: people, offices, geofences, settings and audit.",
  HR: "Manages people, attendance corrections, leave and organisation-wide reporting.",
  MANAGER: "Manages their own team's tasks, attendance visibility and leave approvals.",
  EMPLOYEE: "Their own tasks, attendance and leave, plus a read-only view of colleagues.",
};
