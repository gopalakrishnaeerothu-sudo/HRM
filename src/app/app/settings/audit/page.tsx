import type { Metadata } from "next";
import { FileClock } from "lucide-react";

import { formatDateTime } from "@/lib/time";
import { requirePermission } from "@/server/auth";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { auditService } from "@/server/services/audit-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { AuditAction } from "@/server/db/types";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Audit log" };

const ACTION_TONE: Record<AuditAction, "success" | "info" | "critical" | "neutral" | "warning" | "serious"> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "critical",
  LOGIN: "neutral",
  LOGOUT: "neutral",
  PERMISSION_CHANGE: "warning",
  GEOFENCE_CHANGE: "warning",
  ATTENDANCE_OVERRIDE: "serious",
  EXPORT: "neutral",

  // Security events. A single failed sign-in is ordinary and a run of them is
  // not, but the log shows one row at a time — "warning" reads correctly for
  // both, where "critical" would cry wolf on every mistyped password.
  LOGIN_FAILURE: "warning",
  PASSWORD_CHANGED: "info",
  PASSWORD_RESET_REQUESTED: "warning",
  PASSWORD_RESET_COMPLETED: "info",
  ACCOUNT_DISABLED: "critical",
  SESSION_REVOKED: "warning",

  // Access decisions. Every one of these changes who can reach the system at
  // all, so none of them are "neutral" — someone scanning the log should not
  // have to read the label to notice that access moved. The asymmetry is
  // deliberate: granting is routine and reads as "success" or "info",
  // withdrawing is the row somebody comes looking for months later and reads
  // as "critical". ROLE_CHANGED sits between the two — not a withdrawal, but
  // the event that answers "who made them an administrator", so it must not
  // blend into the ordinary traffic.
  USER_SIGNUP: "info",
  USER_INVITED: "info",
  USER_APPROVED: "success",
  USER_REJECTED: "warning",
  ACCOUNT_ENABLED: "success",
  ACCOUNT_LOCKED: "serious",
  ACCOUNT_UNLOCKED: "info",
  ROLE_CHANGED: "serious",
  ACCESS_REVOKED: "critical",
};

/**
 * Audit trail.
 *
 * Read-only by design: there is no edit or delete path to these rows anywhere
 * in the codebase, because a mutable audit log is not an audit log.
 */
export default async function AuditLogPage() {
  const session = await requirePermission("audit:read");
  const entries = await auditService.list(tenantScopeFor(session), 100);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Settings", href: "/app/settings" }, { label: "Audit log" }]}
        title="Audit log"
        description="Employee changes, geofence edits, attendance overrides and permission changes. Append-only."
      />

      <PageBody>
        <Card className="overflow-hidden">
          {entries.length === 0 ? (
            <EmptyState
              icon={<FileClock />}
              size="page"
              title="Nothing logged yet"
              description="Sensitive changes will appear here as they happen."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {entries.map((entry) => {
                const changes = entry.changes as Record<string, unknown> | null;

                return (
                  <li key={entry.id} className="flex flex-wrap gap-4 px-5 py-4 sm:px-6">
                    <Avatar
                      name={entry.actor?.name ?? "System"}
                      src={entry.actor?.avatarUrl}
                      size="sm"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-ink">
                          {entry.actor?.name ?? "System"}
                        </p>
                        {entry.actor ? (
                          <Badge tone="outline" size="sm">
                            {ROLE_LABELS[entry.actor.role]}
                          </Badge>
                        ) : null}
                        <Badge tone={ACTION_TONE[entry.action]} size="sm">
                          {entry.action.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                      </div>

                      <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
                        {entry.summary}
                      </p>

                      {changes && Object.keys(changes).length > 0 ? (
                        <div className="table-scroll mt-2.5">
                          <pre className="w-fit min-w-full rounded-lg bg-surface-2 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-ink-muted">
                            {JSON.stringify(changes, null, 2)}
                          </pre>
                        </div>
                      ) : null}

                      <p className="mt-2 text-xs text-ink-muted">
                        {formatDateTime(entry.createdAt, session.organization.timezone)}
                        <span className="mx-1.5" aria-hidden>
                          ·
                        </span>
                        {entry.entityType}
                        {entry.ipAddress ? (
                          <>
                            <span className="mx-1.5" aria-hidden>
                              ·
                            </span>
                            <span className="font-mono">{entry.ipAddress}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
