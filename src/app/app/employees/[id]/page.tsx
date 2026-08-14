import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Briefcase,
  Building2,
  CalendarDays,
  Mail,
  Pencil,
  Phone,
  Users,
} from "lucide-react";

import { formatMinutes } from "@/lib/utils";
import { addDays, formatDate, zonedDateKey } from "@/lib/time";
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from "@/lib/validation/employee";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { can, requirePagePermission } from "@/server/auth";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { taskService } from "@/server/services/task-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { ATTENDANCE_STATUS_TONE, attendanceRate } from "@/server/services/attendance-rules";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from "@/components/ui/table";
import { TaskListItem } from "@/components/tasks/task-list-item";

const STATUS_TONE = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  ON_LEAVE: "info",
  SUSPENDED: "critical",
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requirePagePermission("employee:read");
  const { id } = await params;
  const employee = await employeeRepository.findById(tenantScopeFor(session), id);
  return { title: employee ? `${employee.firstName} ${employee.lastName}` : "Employee" };
}

/**
 * Employee profile: identity, reporting line, attendance history and task
 * history. Reads are tenant-scoped by the repository, so a foreign id 404s.
 */
export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("employee:read");
  const { id } = await params;
  const scope = tenantScopeFor(session);

  const employee = await employeeRepository.findById(scope, id);
  if (!employee) notFound();

  const today = zonedDateKey(new Date(), session.organization.timezone);
  const monthAgo = addDays(today, -29);

  const [attendance, tasks] = await Promise.all([
    attendanceRepository.list(scope, { employeeIds: [id], from: monthAgo, to: today }, 1, 10),
    taskService.list(session, {
      page: 1,
      pageSize: 8,
      scope: "all",
      assigneeId: id,
      sortBy: "dueDate",
      sortOrder: "asc",
    }),
  ]);

  const summary = attendanceRate(attendance.items);
  const totalMinutes = attendance.items.reduce((sum, record) => sum + record.workedMinutes, 0);
  const canEdit = can(session, "employee:update");

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Employees", href: "/app/employees" },
          { label: `${employee.firstName} ${employee.lastName}` },
        ]}
        title={`${employee.firstName} ${employee.lastName}`}
        description={`${employee.designation} · ${employee.employeeCode}`}
        meta={
          <Badge tone={STATUS_TONE[employee.status]} size="sm">
            {EMPLOYEE_STATUS_LABELS[employee.status]}
          </Badge>
        }
        actions={
          canEdit ? (
            <Button size="sm" variant="secondary" asChild>
              <Link href={`/app/employees/${employee.id}/edit`}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
          ) : null
        }
      />

      <PageBody>
        <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
          {/* Identity card */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
                <Avatar
                  name={`${employee.firstName} ${employee.lastName}`}
                  src={employee.avatarUrl}
                  size="2xl"
                />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold tracking-tight text-ink">
                    {employee.firstName} {employee.lastName}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">{employee.designation}</p>
                </div>

                {employee.bio ? (
                  <p className="text-sm leading-relaxed text-ink-secondary">{employee.bio}</p>
                ) : null}
              </CardContent>

              <CardContent className="flex flex-col gap-3 border-t border-line pt-5">
                <DetailRow icon={<Mail />} label="Email" value={employee.email} />
                {employee.phone ? (
                  <DetailRow icon={<Phone />} label="Phone" value={employee.phone} />
                ) : null}
                <DetailRow
                  icon={<Briefcase />}
                  label="Employment"
                  value={EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                />
                <DetailRow
                  icon={<CalendarDays />}
                  label="Joined"
                  value={formatDate(employee.joinedAt)}
                />
                {employee.department ? (
                  <DetailRow icon={<Users />} label="Department" value={employee.department.name} />
                ) : null}
                {employee.primaryOffice ? (
                  <DetailRow
                    icon={<Building2 />}
                    label="Office"
                    value={`${employee.primaryOffice.name}, ${employee.primaryOffice.city}`}
                  />
                ) : null}
              </CardContent>
            </Card>

            {employee.manager || employee.reports.length > 0 ? (
              <Card>
                <CardHeader compact>
                  <CardTitle>Reporting line</CardTitle>
                </CardHeader>
                <CardContent compact className="flex flex-col gap-4">
                  {employee.manager ? (
                    <div>
                      <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                        Reports to
                      </p>
                      <PersonRow
                        id={employee.manager.id}
                        name={`${employee.manager.firstName} ${employee.manager.lastName}`}
                        avatarUrl={employee.manager.avatarUrl}
                      />
                    </div>
                  ) : null}

                  {employee.reports.length > 0 ? (
                    <div>
                      <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                        Direct reports · {employee.reports.length}
                      </p>
                      <ul className="flex flex-col gap-2">
                        {employee.reports.map((report) => (
                          <li key={report.id}>
                            <PersonRow
                              id={report.id}
                              name={`${report.firstName} ${report.lastName}`}
                              avatarUrl={report.avatarUrl}
                              subtitle={report.designation}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {employee.teamMemberships.length > 0 ? (
              <Card>
                <CardHeader compact>
                  <CardTitle>Teams</CardTitle>
                </CardHeader>
                <CardContent compact>
                  <ul className="flex flex-wrap gap-2">
                    {employee.teamMemberships.map((membership) => (
                      <li key={membership.team.id}>
                        <Badge tone="outline">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: membership.team.color }}
                            aria-hidden
                          />
                          {membership.team.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Activity */}
          <div className="min-w-0">
            <Tabs defaultValue="attendance">
              <TabsList>
                <TabsTrigger value="attendance">
                  <CalendarDays aria-hidden />
                  Attendance
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  <Briefcase aria-hidden />
                  Tasks
                </TabsTrigger>
              </TabsList>

              <TabsContent value="attendance">
                <div className="flex flex-col gap-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MiniStat
                      label="Attendance rate"
                      value={`${Math.round(summary.rate * 100)}%`}
                      hint={`${summary.attendedDays} of ${summary.workingDays} days`}
                    />
                    <MiniStat label="Hours (30 days)" value={formatMinutes(totalMinutes)} hint="Excluding breaks" />
                    <MiniStat
                      label="Late days"
                      value={String(attendance.items.filter((record) => record.lateByMinutes > 0).length)}
                      hint="After the grace period"
                    />
                  </div>

                  <Card className="overflow-hidden">
                    <CardHeader compact>
                      <CardTitle>Recent attendance</CardTitle>
                    </CardHeader>

                    {attendance.items.length === 0 ? (
                      <EmptyState
                        icon={<CalendarDays />}
                        title="No attendance recorded"
                        description="Nothing has been logged for this employee in the last 30 days."
                      />
                    ) : (
                      <TableWrap>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>In</TableHead>
                              <TableHead>Out</TableHead>
                              <TableHead numeric>Worked</TableHead>
                              <TableHead>Office</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {attendance.items.map((record) => (
                              <TableRow key={record.id}>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(record.date)}
                                </TableCell>
                                <TableCell>
                                  <Badge tone={ATTENDANCE_STATUS_TONE[record.status]} size="sm">
                                    {ATTENDANCE_STATUS_LABELS[record.status]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-ink-secondary">
                                  {record.checkInAt
                                    ? new Intl.DateTimeFormat("en-US", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        hour12: true,
                                        timeZone: session.organization.timezone,
                                      }).format(record.checkInAt)
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-ink-secondary">
                                  {record.checkOutAt
                                    ? new Intl.DateTimeFormat("en-US", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        hour12: true,
                                        timeZone: session.organization.timezone,
                                      }).format(record.checkOutAt)
                                    : "—"}
                                </TableCell>
                                <TableCell numeric className="text-ink-secondary">
                                  {record.workedMinutes > 0 ? formatMinutes(record.workedMinutes) : "—"}
                                </TableCell>
                                <TableCell className="text-ink-secondary">
                                  {record.office?.name ?? "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableWrap>
                    )}
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="tasks">
                <Card className="overflow-hidden">
                  <CardHeader compact>
                    <CardTitle>Assigned tasks</CardTitle>
                  </CardHeader>
                  {tasks.items.length === 0 ? (
                    <EmptyState
                      icon={<Briefcase />}
                      title="No tasks assigned"
                      description="This employee has no tasks assigned to them right now."
                    />
                  ) : (
                    <ul className="divide-y divide-[var(--line)] border-t border-line">
                      {tasks.items.map((task) => (
                        <TaskListItem key={task.id} task={task} />
                      ))}
                    </ul>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-ink-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.6875rem] text-ink-muted">{label}</p>
        <p className="truncate text-sm text-ink">{value}</p>
      </div>
    </div>
  );
}

function PersonRow({
  id,
  name,
  avatarUrl,
  subtitle,
}: {
  id: string;
  name: string;
  avatarUrl: string | null;
  subtitle?: string;
}) {
  return (
    <Link
      href={`/app/employees/${id}`}
      className="flex min-w-0 items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <Avatar name={name} src={avatarUrl} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{name}</span>
        {subtitle ? <span className="block truncate text-xs text-ink-muted">{subtitle}</span> : null}
      </span>
    </Link>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glass-card p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular text-ink">{value}</p>
      <p className="mt-0.5 text-[0.6875rem] text-ink-muted">{hint}</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
