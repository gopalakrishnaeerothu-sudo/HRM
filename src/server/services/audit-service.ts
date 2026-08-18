import "server-only";

import type { AuditAction } from "@/server/db/types";
import { headers } from "next/headers";

import type { AuthSession } from "@/server/auth/types";
import { auditRepository } from "@/server/repositories/org-repository";
import type { TenantScope } from "@/server/repositories/tenant";

/**
 * Audit logging for sensitive operations.
 *
 * Called from inside the same transaction as the change it describes, so the
 * log and the change either both land or neither does.
 *
 * Two rules about content:
 *  - Values are diffed field by field, and only the fields that actually
 *    changed are stored.
 *  - `REDACTED_FIELDS` never make it into the log, because an audit trail that
 *    leaks the data it is auditing is worse than none.
 */

const REDACTED_FIELDS = new Set(["password", "passwordHash", "token", "tokenHash", "authSecret", "secret"]);

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Best-effort client metadata. `x-forwarded-for` is set by Railway's proxy;
 * it is advisory only and is never used for an authorisation decision.
 */
export async function requestContext(): Promise<AuditContext> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    return {
      ipAddress: forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip"),
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    // Outside a request scope (e.g. the seed script).
    return {};
  }
}

type Diffable = Record<string, unknown>;

/** Field-level diff, with redacted keys and unchanged fields dropped. */
export function diff(before: Diffable | null, after: Diffable): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, nextValue] of Object.entries(after)) {
    if (REDACTED_FIELDS.has(key)) continue;

    const previousValue = before?.[key];
    const normalisedPrevious = previousValue instanceof Date ? previousValue.toISOString() : previousValue;
    const normalisedNext = nextValue instanceof Date ? nextValue.toISOString() : nextValue;

    if (JSON.stringify(normalisedPrevious) === JSON.stringify(normalisedNext)) continue;
    changes[key] = { from: normalisedPrevious ?? null, to: normalisedNext ?? null };
  }

  return changes;
}

export interface AuditEntry {
  action: AuditAction;
  /** Table-ish name, e.g. "employees", "office_geofences". */
  entityType: string;
  entityId?: string | null;
  /** One-line human summary, shown verbatim in the audit UI. */
  summary: string;
  changes?: Record<string, unknown> | null;
  context?: AuditContext;
}

export const auditService = {
  async record(scope: TenantScope, session: AuthSession | null, entry: AuditEntry): Promise<void> {
    const context = entry.context ?? (await requestContext());

    try {
      await auditRepository.record(scope, {
        actorUserId: session?.user.id ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        changes: (entry.changes ?? undefined) as never,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      });
    } catch (error) {
      // A failed audit write must not roll back a legitimate business action,
      // but it must be loud — this is the line an operator greps for.
      console.error("[audit] failed to record entry", { entry: entry.summary, error });
    }
  },

  async list(scope: TenantScope, limit = 50, entityType?: string) {
    return auditRepository.list(scope, limit, entityType);
  },
};

/** Formats a geofence radius change the way the spec's example reads. */
export function describeGeofenceChange(
  officeName: string,
  from: { radiusMeters: number; latitude: number; longitude: number },
  to: { radiusMeters: number; latitude: number; longitude: number },
): string {
  const parts: string[] = [];
  if (from.radiusMeters !== to.radiusMeters) {
    parts.push(`radius ${from.radiusMeters}m → ${to.radiusMeters}m`);
  }
  if (from.latitude !== to.latitude || from.longitude !== to.longitude) {
    parts.push(
      `centre ${from.latitude.toFixed(5)}, ${from.longitude.toFixed(5)} → ${to.latitude.toFixed(5)}, ${to.longitude.toFixed(5)}`,
    );
  }
  return `Changed ${officeName} geofence: ${parts.join("; ") || "no effective change"}`;
}
