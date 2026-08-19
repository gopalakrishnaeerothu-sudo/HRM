import type { UserRole } from "@/server/db/types";

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
  // User access management
  "user:read",
  "user:invite",
  "user:approve",
  "user:manage",
  "user:role:assign",
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
  // Onboarding is HR's job, so the access queue is too. What HR *cannot* do is
  // reach above itself: every one of these is additionally bounded by
  // `canActOn` and `canAssignRole` below, which cap HR at MANAGER.
  "user:read",
  "user:invite",
  "user:approve",
  "user:manage",
  "user:role:assign",
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

// ---------------------------------------------------------------------------
// Role seniority
//
// A permission answers "may this role manage users at all". It cannot answer
// "may this particular administrator disable the owner", because that depends
// on both parties. These two functions answer that, and every access-
// management path runs through them.
//
// The rule is one sentence: you may act on people below you, and grant roles
// below you. It is what stops the two escalations that matter — an HR admin
// promoting themselves to OWNER, and an ADMIN disabling the OWNER's account.
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<UserRole, number> = {
  EMPLOYEE: 0,
  MANAGER: 1,
  HR: 2,
  ADMIN: 3,
  OWNER: 4,
};

/**
 * Whether `actor` may perform an access action on an account holding `target`.
 *
 * Strictly greater, so peers cannot act on each other: one ADMIN disabling
 * another is how a compromised admin account locks the real ones out. OWNER is
 * above everything and is therefore untouchable here, which is precisely the
 * "cannot be removed by an admin" property ROLE_PERMISSIONS notes but cannot
 * itself enforce.
 *
 * Self-action is rejected by the caller rather than here — the service layer
 * has a clearer message for it, and conflating "you are your own peer" with
 * "you outrank nobody" would make this function's contract fuzzier.
 */
export function canActOn(actor: UserRole, target: UserRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/**
 * Whether `actor` may grant `target` to somebody.
 *
 * Same rule, and it is deliberately the same bound: an actor who could grant
 * their own role could clone themselves, and an actor who could grant a higher
 * one could escalate through a proxy account. OWNER is never grantable through
 * this surface at all — transferring ownership is a different operation with
 * different confirmations, not a dropdown on the users table.
 */
export function canAssignRole(actor: UserRole, target: UserRole): boolean {
  if (target === "OWNER") return false;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/** The roles `actor` may choose from, for rendering a dropdown. */
export function assignableRoles(actor: UserRole): UserRole[] {
  return (Object.keys(ROLE_RANK) as UserRole[])
    .filter((role) => canAssignRole(actor, role))
    .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
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
