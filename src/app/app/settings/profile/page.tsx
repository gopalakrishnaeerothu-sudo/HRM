import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Shield, User } from "lucide-react";

import { formatDate } from "@/lib/time";
import { requireSession } from "@/server/auth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/auth/permissions";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { tenantScopeFor } from "@/server/services/access-service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "My profile" };

/**
 * The signed-in user's own profile.
 *
 * Read-only for now: self-service editing needs an authenticated identity to
 * hang it off, so it lands with the real auth provider rather than being
 * mocked here. Everything shown comes from the session and the employee record.
 */
export default async function ProfilePage() {
  const session = await requireSession();

  const employee = session.employee
    ? await employeeRepository.findById(tenantScopeFor(session), session.employee.id)
    : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Settings", href: "/app/settings" }, { label: "My profile" }]}
        title="My profile"
        description="Your account and employee record."
      />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
              <Avatar name={session.user.name} src={session.user.avatarUrl} size="2xl" />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight text-ink">
                  {session.user.name}
                </p>
                <p className="mt-0.5 truncate text-sm text-ink-muted">
                  {employee?.designation ?? session.user.email}
                </p>
              </div>
              <Badge tone="brand">{ROLE_LABELS[session.user.role]}</Badge>

              {employee ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/app/employees/${employee.id}`}>View full profile</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <User className="size-4 text-ink-muted" aria-hidden />
                    Account
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3.5">
                <Row label="Name" value={session.user.name} />
                <Row label="Email" value={session.user.email} />
                <Row label="Organisation" value={session.organization.name} />
                <Row label="Timezone" value={session.organization.timezone} />
                {employee ? (
                  <>
                    <Row label="Employee ID" value={employee.employeeCode} mono />
                    <Row label="Joined" value={formatDate(employee.joinedAt)} />
                    {employee.department ? (
                      <Row label="Department" value={employee.department.name} />
                    ) : null}
                    {employee.primaryOffice ? (
                      <Row
                        label="Office"
                        value={`${employee.primaryOffice.name}, ${employee.primaryOffice.city}`}
                      />
                    ) : null}
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <Shield className="size-4 text-ink-muted" aria-hidden />
                    Access
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                  <p className="text-sm font-medium text-ink">{ROLE_LABELS[session.user.role]}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    {ROLE_DESCRIPTIONS[session.user.role]}
                  </p>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-4">
                  <Mail className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                  <div className="min-w-0 text-xs leading-relaxed text-ink-muted">
                    <p className="font-medium text-ink-secondary">
                      Editing your own details isn&apos;t available yet
                    </p>
                    <p className="mt-1">
                      Self-service profile editing needs a verified identity to attach it to, so it
                      ships with the real authentication provider rather than being stubbed here. In
                      the meantime, ask HR to update your record.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-ink-muted">{label}</span>
      <span className={`min-w-0 truncate text-sm text-ink ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export const dynamic = "force-dynamic";
