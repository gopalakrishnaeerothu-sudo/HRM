import type { UserRole } from "@prisma/client";

import type { Permission } from "@/server/auth/permissions";

/**
 * The authenticated principal.
 *
 * Everything the authorisation layer needs is resolved *here*, on the server,
 * from the session — never from a request body or query string. Route handlers
 * that accept an `organizationId` or `employeeId` from the client compare it
 * against this object and reject a mismatch.
 */
export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    role: UserRole;
  };
  /** Tenant scope. Every repository call is filtered by this id. */
  organization: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
  };
  /**
   * The employee profile linked to this user, when there is one. An
   * administrator account may exist without an employee record, so this is
   * nullable and callers that need it use `requireEmployee`.
   */
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation: string;
    avatarUrl: string | null;
    departmentId: string | null;
    managerId: string | null;
    primaryOfficeId: string | null;
  } | null;
  /** Tenant-level grants/revocations layered over the role defaults. */
  permissionOverrides: ReadonlyMap<Permission, boolean>;
  /** How this session was established — surfaced in the UI when it is DEV. */
  strategy: AuthStrategy;
}

export type AuthStrategy = "dev-impersonation" | "session-cookie" | "oauth" | "sso";

/**
 * Contract every authentication implementation must satisfy.
 *
 * The rest of the application depends only on this interface, so replacing the
 * development adapter with email/password, OTP, Google, Microsoft or SSO is a
 * matter of providing another implementation and registering it in
 * `src/server/auth/index.ts` — no changes anywhere else.
 */
export interface AuthAdapter {
  readonly name: string;
  readonly strategy: AuthStrategy;

  /** Resolve the caller from the incoming request's cookies. */
  getSession(): Promise<AuthSession | null>;

  /** Establish a session. Returns the cookie value the caller should set. */
  signIn(credentials: SignInCredentials): Promise<{ session: AuthSession; token: string }>;

  /** Invalidate the current session server-side. */
  signOut(): Promise<void>;
}

export type SignInCredentials =
  | { kind: "dev-impersonation"; userId: string }
  | { kind: "password"; email: string; password: string }
  | { kind: "otp"; phone: string; code: string }
  | { kind: "oauth"; provider: "google" | "microsoft"; code: string };

export const SESSION_COOKIE = "tfhr_session";
