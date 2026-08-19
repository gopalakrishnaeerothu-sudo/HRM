import "server-only";

/**
 * Row shapes and mappers.
 *
 * ─── Why mappers exist at all ───────────────────────────────────────────────
 * The database speaks snake_case, because that is what PostgreSQL is
 * comfortable with unquoted. The application speaks camelCase, because that is
 * what TypeScript and React are comfortable with. Rather than force one
 * convention on the other, each repository converts at its own boundary — the
 * only place in the stack where both vocabularies are visible.
 *
 * The mappers are hand-written rather than generic. A `snakeToCamel(row)`
 * helper would be shorter, but it returns `any`, and losing the row type at
 * the exact point where SQL meets TypeScript defeats the purpose of having
 * types at all. These are explicit so the compiler catches a renamed column.
 */

// ---------------------------------------------------------------------------
// Enum unions — mirrored from migrations/001_initial_schema.sql
//
// The database is authoritative; these must match it. A value returned by
// PostgreSQL that is missing here is a compile error at the point of use,
// which is where it should surface.
// ---------------------------------------------------------------------------

export type OrganizationPlan = "FREE" | "STARTER" | "GROWTH" | "ENTERPRISE";
export type UserRole = "OWNER" | "ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";
/**
 * Account access state.
 *
 * INVITED and PENDING are both "not yet in use" but arrive from opposite
 * directions: INVITED was created by an administrator and is merely unclaimed,
 * PENDING was requested by a stranger and needs a decision. Only ACTIVE
 * resolves a session — enforced in the session lookup, not by callers.
 *
 * LOCKED was added by migration 017 and PENDING/REJECTED by 018.
 */
export type UserStatus =
  | "ACTIVE"
  | "INVITED"
  | "PENDING"
  | "DISABLED"
  | "REJECTED"
  | "LOCKED";
export type AuthProvider = "DEV" | "PASSWORD" | "OTP" | "GOOGLE" | "MICROSOFT" | "SSO";
export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "ON_LEAVE" | "SUSPENDED";
export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN" | "CONSULTANT";
export type OfficeStatus = "ACTIVE" | "INACTIVE";

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "HALF_DAY"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKEND";

export type AttendanceEventType = "CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END";

export type LocationVerification =
  | "VERIFIED"
  | "OUTSIDE_GEOFENCE"
  | "LOW_ACCURACY"
  | "NO_LOCATION"
  | "SUSPECTED_SPOOF"
  | "MANUAL_OVERRIDE";

export type AttendanceSource = "WEB" | "MOBILE" | "KIOSK" | "MANUAL" | "SYSTEM";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "COMPLETED" | "BLOCKED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type TaskActivityType =
  | "CREATED"
  | "UPDATED"
  | "STATUS_CHANGED"
  | "PRIORITY_CHANGED"
  | "ASSIGNED"
  | "UNASSIGNED"
  | "PROGRESS_UPDATED"
  | "COMMENTED"
  | "ATTACHMENT_ADDED"
  | "SUBTASK_ADDED"
  | "SUBTASK_COMPLETED"
  | "DUE_DATE_CHANGED"
  | "COMPLETED"
  | "REOPENED";

export type LeaveType =
  | "CASUAL"
  | "SICK"
  | "EARNED"
  | "UNPAID"
  | "MATERNITY"
  | "PATERNITY"
  | "COMP_OFF";

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_DUE_SOON"
  | "TASK_OVERDUE"
  | "TASK_COMPLETED"
  | "TASK_COMMENT"
  | "ATTENDANCE_REMINDER"
  | "LATE_ARRIVAL"
  | "MISSED_CHECKOUT"
  | "LEAVE_REQUESTED"
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "ANNOUNCEMENT"
  | "GEOFENCE_ALERT";

export type NotificationChannel = "IN_APP" | "EMAIL" | "PUSH";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT"
  | "PERMISSION_CHANGE"
  | "GEOFENCE_CHANGE"
  | "ATTENDANCE_OVERRIDE"
  | "EXPORT"
  // Security events — added with the authentication schema, migration 017.
  | "LOGIN_FAILURE"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "ACCOUNT_DISABLED"
  | "SESSION_REVOKED"
  // Access decisions — added with user access management, migration 018.
  | "USER_SIGNUP"
  | "USER_APPROVED"
  | "USER_REJECTED"
  | "USER_INVITED"
  | "ACCOUNT_ENABLED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_UNLOCKED"
  | "ROLE_CHANGED"
  | "ACCESS_REVOKED";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * A row joined via LEFT JOIN is present-but-all-null rather than absent.
 * This turns that into `null`, so callers get an honest optional instead of an
 * object full of nulls that looks like a real record.
 */
export function nullableRelation<T extends object>(
  idValue: unknown,
  build: () => T,
): T | null {
  return idValue === null || idValue === undefined ? null : build();
}

/**
 * PostgreSQL returns NUMERIC as a string unless a parser is registered.
 * `client.ts` registers one, but aggregates computed in a query (`SUM`, `AVG`)
 * can still arrive as strings depending on the expression, so this coerces
 * defensively.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** COUNT(*) arrives as a bigint string on some driver paths. */
export function toCount(value: unknown): number {
  return Math.trunc(toNumber(value, 0));
}

/** Normalise a nullable text column to `string | null` rather than `""`. */
export function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length === 0 ? null : text;
}

/**
 * PostgreSQL array columns arrive as JS arrays via the driver, but a NULL
 * column arrives as null. Callers always want an array.
 */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

export function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((entry) => toNumber(entry));
  return [];
}
