/**
 * Application error taxonomy.
 *
 * Two rules drive this file:
 *  1. A user never sees a database error, a stack trace, or an internal id.
 *     `toPublicError` maps anything thrown into a safe shape.
 *  2. "Not found" and "not yours" collapse into the same 404 response, so a
 *     caller cannot probe another tenant's id space by watching status codes.
 */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "GEOFENCE_REJECTED"
  | "LOCATION_UNAVAILABLE"
  | "PRECONDITION_FAILED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  GEOFENCE_REJECTED: 403,
  LOCATION_UNAVAILABLE: 400,
  PRECONDITION_FAILED: 412,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Field-level messages for form display. Safe to send to the client. */
  readonly details?: Record<string, string[]>;
  /** Extra machine-readable context, e.g. distance for a geofence rejection. */
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: Record<string, string[]>; meta?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options?.details;
    this.meta = options?.meta;
  }
}

export const errors = {
  validation: (message = "Please check the highlighted fields.", details?: Record<string, string[]>) =>
    new AppError("VALIDATION_FAILED", message, { details }),

  unauthenticated: (message = "You need to sign in to continue.") =>
    new AppError("UNAUTHENTICATED", message),

  forbidden: (message = "You don't have permission to do that.") => new AppError("FORBIDDEN", message),

  /** Also used for cross-tenant access — see the note at the top of this file. */
  notFound: (what = "record") => new AppError("NOT_FOUND", `That ${what} doesn't exist.`),

  conflict: (message: string) => new AppError("CONFLICT", message),

  rateLimited: (retryAfterSeconds: number) =>
    new AppError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", {
      meta: { retryAfterSeconds },
    }),

  precondition: (message: string) => new AppError("PRECONDITION_FAILED", message),

  internal: (cause?: unknown) =>
    new AppError("INTERNAL", "Something went wrong on our end. The issue has been logged.", { cause }),
} as const;

export interface PublicError {
  code: ErrorCode;
  message: string;
  details?: Record<string, string[]>;
  meta?: Record<string, unknown>;
}

/**
 * Normalise anything thrown into a client-safe payload, logging the original
 * server-side. Unknown errors are always reported as a generic 500 — their
 * message may contain a connection string or a row's contents.
 */
export function toPublicError(error: unknown): { status: number; body: { error: PublicError } } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...(error.meta ? { meta: error.meta } : {}),
        },
      },
    };
  }

  // Anything else is unexpected: log the detail, return nothing useful.
  console.error("[unhandled]", error);
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL",
        message: "Something went wrong on our end. The issue has been logged.",
      },
    },
  };
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
