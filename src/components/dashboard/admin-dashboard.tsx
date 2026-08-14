import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  ListTodo,
  UserMinus,
  Users,
} from "lucide-react";

import { formatPercent } from "@/lib/utils";
import { formatDate } from "@/lib/time";
import type { AuthSession } from "@/server/auth/types";
import { dashboardService } from "@/server/services/dashboard-service";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { tenantScopeFor } from "@/server/services/access-service";
import { RISK_FLAG_LABELS, type GeoRiskFlag } from "@/server/geo/verify";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { AttendanceTrendChart, TaskTrendChart } from "@/components/charts/attendance-trend-chart";
import { DepartmentDistributionChart } from "@/components/charts/distribution-charts";

/**
 * Organisation-wide dashboard for OWNER, ADMIN and HR.
 *
 * A Server Component: the aggregates are computed in PostgreSQL and rendered
 * to HTML, so the browser downloads numbers rather than rows. Only the charts
 * below are client components.
 */
export async function AdminDashboard({ session }: { session: AuthSession }) {
  const scope = tenantScopeFor(session);

  const [overview, attendanceTrend, taskTrend, departments, flaggedEvents] = await Promise.all([
    dashboardService.overview(session),
    dashboardService.attendanceTrend(session, 14),
    dashboardService.taskTrend(session, 14),
    dashboardService.departmentWorkload(session),
    attendanceRepository.listFlaggedEvents(scope, 6),
  ]);

  return (
    <>
      <PageHeader
        title={`Good day, ${session.user.name.split(" ")[0]}`}
        description={`${session.organization.name} · ${formatDate(overview.today, overview.timezone)}`}
        meta={
          <Badge tone="brand" size="sm">
            {overview.officeCount} {overview.officeCount === 1 ? "office" : "offices"} active
          </Badge>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/app/reports">View reports</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/app/employees/new">Add employee</Link>
            </Button>
          </>
        }
      />

      <PageBody>
        <StatGrid>
          <StatCard
            label="Total employees"
            value={overview.totalEmployees}
            icon={<Users />}
            accent="brand"
            footer={`${overview.activeEmployees} active`}
          />
          <StatCard
            label="Present today"
            value={overview.presentToday}
            icon={<CalendarCheck />}
            accent="success"
            delta={overview.presentDelta}
            deltaLabel="vs yesterday"
            hint={`${formatPercent(overview.attendanceRateToday)} of expected staff`}
          />
          <StatCard
            label="Absent today"
            value={overview.absentToday}
            icon={<UserMinus />}
            accent="critical"
            footer={`${overview.onLeaveToday} on approved leave`}
          />
          <StatCard
            label="Late today"
            value={overview.lateToday}
            icon={<Clock />}
            accent="warning"
            footer="After the grace period"
          />
        </StatGrid>

        <StatGrid>
          <StatCard
            label="Active tasks"
            value={overview.activeTasks}
            icon={<ListTodo />}
            accent="info"
            footer="Not yet completed"
          />
          <StatCard
            label="Completed tasks"
            value={overview.completedTasks}
            icon={<CheckCircle2 />}
            accent="success"
            footer={`${formatPercent(overview.taskCompletionRate)} completion rate`}
          />
          <StatCard
            label="Overdue tasks"
            value={overview.overdueTasks}
            icon={<AlertTriangle />}
            accent="critical"
            invertDelta
            footer="Past their due date"
          />
          <StatCard
            label="Office utilisation"
            value={Math.round(overview.officeUtilisation * 100)}
            suffix="%"
            icon={<Building2 />}
            accent="brand"
            footer="Present vs office-assigned staff"
          />
        </StatGrid>

        <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
          <AttendanceTrendChart data={attendanceTrend} />
          <DepartmentDistributionChart
            data={departments.map((department) => ({
              name: department.name,
              count: department.count,
              openTasks: department.openTasks,
            }))}
            description="Active employees per department."
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
          <TaskTrendChart data={taskTrend} />

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Location review</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Check-ins the server flagged or refused.
                </p>
              </div>
            </CardHeader>
            <CardContent flush>
              {flaggedEvents.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 />}
                  title="Nothing to review"
                  description="Every recent check-in was verified inside an office perimeter."
                />
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {flaggedEvents.map((event) => {
                    const flags = event.riskFlags as GeoRiskFlag[];
                    const refused = event.verification === "OUTSIDE_GEOFENCE";

                    return (
                      <li key={event.id} className="flex gap-3 px-5 py-3.5 sm:px-6">
                        <Avatar
                          name={`${event.employee.firstName} ${event.employee.lastName}`}
                          src={event.employee.avatarUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-ink">
                              {event.employee.firstName} {event.employee.lastName}
                            </p>
                            <Badge tone={refused ? "critical" : "warning"} size="sm">
                              {refused ? "Refused" : "Flagged"}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {event.office?.name ?? "No office matched"}
                            {event.distanceMeters !== null
                              ? ` · ${Math.round(event.distanceMeters)} m from centre`
                              : ""}
                          </p>
                          {flags.length > 0 ? (
                            <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-muted">
                              {flags.map((flag) => RISK_FLAG_LABELS[flag] ?? flag).join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {overview.absentEmployees.length > 0 ? (
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Not checked in yet</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Active employees with no attendance record for today.
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/app/attendance">View attendance</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2">
                {overview.absentEmployees.map((employee) => (
                  <li
                    key={employee.id}
                    className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 py-1 pl-1 pr-3"
                  >
                    <Avatar
                      name={`${employee.firstName} ${employee.lastName}`}
                      src={employee.avatarUrl}
                      size="xs"
                    />
                    <span className="truncate text-xs font-medium text-ink-secondary">
                      {employee.firstName} {employee.lastName}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}
