import type { Metadata } from "next";
import { FileClock } from "lucide-react";

import { formatDateTime } from "@/lib/time";
import { requirePagePermission } from "@/server/auth";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { auditService } from "@/server/services/audit-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Audit log" };

const ACTION_TONE = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "critical",
  LOGIN: "neutral",
  LOGOUT: "neutral",
  PERMISSION_CHANGE: "warning",
  GEOFENCE_CHANGE: "warning",
  ATTENDANCE_OVERRIDE: "serious",
  EXPORT: "neutral",
} as const;

/**
 * Audit trail.
 *
 * Read-only by design: there is no edit or delete path to these rows anywhere
 * in the codebase, because a mutable audit log is not an audit log.
 */
export default async function AuditLogPage() {
  const session = await requirePagePermission("audit:read");
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
