import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, UserCheck, UserPlus, Users, UserX } from "lucide-react";

import { requirePermission } from "@/server/auth";
import { assignableRoles, canActOn, hasPermission } from "@/server/auth/permissions";
import type { UserStatus } from "@/server/db/types";
import { userAccessService } from "@/server/services/user-access-service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { AccessTable, JoinCodePanel } from "@/components/settings/access-table";

export const metadata: Metadata = { title: "Access management" };

export const dynamic = "force-dynamic";

const FILTERS: Array<{ label: string; status?: UserStatus }> = [
  { label: "All" },
  { label: "Pending", status: "PENDING" },
  { label: "Active", status: "ACTIVE" },
  { label: "Disabled", status: "DISABLED" },
  { label: "Locked", status: "LOCKED" },
];

/**
 * Users & access.
 *
 * ─── The gate is `requirePermission`, not the navigation ────────────────────
 * Hiding the sidebar link does not protect this page; landing on the URL
 * directly has to fail for anyone without `user:read`, and that is what the
 * first line of the component does. Everything below it runs having already
 * proved the caller may be here.
 *
 * ─── Why the seniority answers are computed here ────────────────────────────
 * `actionableIds` and `assignableRoles` are resolved on the server from the
 * session's role and handed down. The client could not compute them honestly —
 * it would have to be told the caller's role, and anything the client is told
 * it can also change. The API re-checks both regardless; sending them down
 * only stops the UI offering a button that is going to be refused.
 */
export default async function AccessManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await requirePermission("user:read");
  const params = await searchParams;

  const status = FILTERS.find((filter) => filter.status === params.status)?.status;

  const [page, stats, joinCode] = await Promise.all([
    userAccessService.list(session, {
      status: status ?? undefined,
      search: params.q,
      page: 1,
      pageSize: 100,
    }),
    userAccessService.stats(session),
    userAccessService.joinCode(session),
  ]);

  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    hasPermission(session.user.role, permission, session.permissionOverrides);

  const grantable = assignableRoles(session.user.role);

  const actionableIds = page.items
    .filter((user) => user.id !== session.user.id && canActOn(session.user.role, user.role))
    .map((user) => user.id);

  const pendingUsers = page.items.filter((user) => user.status === "PENDING");

  const users = page.items.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    statusReason: user.statusReason,
    activeSessions: user.activeSessions,
    employee: user.employee
      ? { departmentName: user.employee.departmentName, designation: user.employee.designation }
      : null,
  }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Settings", href: "/app/settings" }, { label: "Users & access" }]}
        title="Users & access"
        description="Who can sign in, what they can do, and who is waiting for a decision."
      />

      <PageBody>
        <StatGrid>
          <StatCard label="Total users" value={stats.total} icon={<Users />} />
          <StatCard
            label="Pending requests"
            value={stats.pending}
            icon={<UserPlus />}
            accent={stats.pending > 0 ? "warning" : undefined}
            hint={stats.pending > 0 ? "Waiting for your decision" : "Nothing waiting"}
          />
          <StatCard label="Active users" value={stats.active} icon={<UserCheck />} accent="success" />
          <StatCard label="Disabled" value={stats.disabled} icon={<UserX />} />
        </StatGrid>

        <StatGrid columns={2} className="mt-4">
          <StatCard label="Managers" value={stats.managers} icon={<ShieldCheck />} />
          <StatCard label="HR &amp; administrators" value={stats.hrAdmins} icon={<ShieldCheck />} />
        </StatGrid>

        {/* The queue, called out above the table. A pending request buried in a
            hundred-row list is a request nobody acts on. */}
        {pendingUsers.length > 0 && can("user:approve") ? (
          <Card className="mt-6 border-warning/30 bg-warning/5">
            <CardHeader>
              <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
                Access requests
                <Badge tone="warning" size="sm">
                  {pendingUsers.length}
                </Badge>
              </h2>
            </CardHeader>
            <CardContent className="pt-0 text-sm leading-relaxed text-ink-secondary">
              {pendingUsers.length === 1
                ? `${pendingUsers[0]!.name} is waiting for a decision.`
                : `${pendingUsers.length} people are waiting for a decision.`}{" "}
              Approving lets you choose their role.
            </CardContent>
          </Card>
        ) : null}

        <Card className="mt-6">
          <CardHeader className="flex flex-wrap items-center justify-between gap-4">
            <nav className="flex flex-wrap gap-1.5" aria-label="Filter by status">
              {FILTERS.map((filter) => {
                const active = filter.status === status;

                return (
                  <Link
                    key={filter.label}
                    href={filter.status ? `?status=${filter.status}` : "?"}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-brand"
                        : "rounded-lg px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink"
                    }
                  >
                    {filter.label}
                  </Link>
                );
              })}
            </nav>

            {can("user:manage") ? (
              <JoinCodePanel code={joinCode.code} canRotate={can("settings:manage")} />
            ) : null}
          </CardHeader>

          <CardContent className="pt-0">
            {page.total === 0 ? (
              <EmptyState
                icon={<Users />}
                title="No accounts yet"
                description="Invite someone, or share your organisation code so they can request access."
              />
            ) : (
              <AccessTable
                users={users}
                assignableRoles={grantable}
                actionableIds={actionableIds}
                canApprove={can("user:approve")}
                canManage={can("user:manage")}
                canAssignRoles={can("user:role:assign")}
              />
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
