import Link from "next/link";
import { CalendarClock, CalendarDays, CheckCircle2, ListTodo, MapPin, Plane, Timer } from "lucide-react";

import { formatMinutes, formatPercent } from "@/lib/utils";
import { formatTime, greetingFor } from "@/lib/time";
import type { AuthSession } from "@/server/auth/types";
import { attendanceService } from "@/server/services/attendance-service";
import { dashboardService } from "@/server/services/dashboard-service";
import { taskService } from "@/server/services/task-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { CheckInPanel } from "@/components/attendance/check-in-panel";
import { TaskListItem } from "@/components/tasks/task-list-item";
import { WeekStrip } from "@/components/attendance/week-strip";

/**
 * The employee's personal workspace: where they stand today, what they owe,
 * and the one action they came here to take.
 *
 * The check-in control is the only client component on the page; everything
 * else renders on the server.
 */
export async function EmployeeDashboard({ session }: { session: AuthSession }) {
  const [today, summary, myTasks] = await Promise.all([
    attendanceService.todayFor(session),
    dashboardService.personalSummary(session),
    taskService.list(session, {
      page: 1,
      pageSize: 6,
      scope: "mine",
      status: ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED"],
      sortBy: "dueDate",
      sortOrder: "asc",
    }),
  ]);

  const firstName = session.employee?.firstName ?? session.user.name.split(" ")[0];
  const greeting = greetingFor(new Date(), today.timezone);
  const primaryOfficeName = today.zones[0]?.officeName ?? null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {greeting}, {firstName}
            <span aria-hidden>👋</span>
          </span>
        }
        description={
          session.employee
            ? `${session.employee.designation} · ${session.organization.name}`
            : session.organization.name
        }
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/app/attendance/my">My attendance</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/app/tasks?scope=mine">My tasks</Link>
            </Button>
          </>
        }
      />

      <PageBody>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
          <CheckInPanel
            officeName={primaryOfficeName}
            hasAssignedOffice={today.zones.length > 0}
            isCheckedIn={today.isCheckedIn}
            isCheckedOut={today.isCheckedOut}
            onBreak={Boolean(today.openBreak)}
            workedMinutes={today.workedMinutes}
            checkInLabel={
              today.record?.checkInAt ? formatTime(today.record.checkInAt, today.timezone) : null
            }
            checkOutLabel={
              today.record?.checkOutAt ? formatTime(today.record.checkOutAt, today.timezone) : null
            }
          />

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>This week</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">Your attendance over the last seven days.</p>
              </div>
            </CardHeader>
            <CardContent>
              <WeekStrip records={summary?.weekRecords ?? []} timezone={today.timezone} />
            </CardContent>
          </Card>
        </div>

        <StatGrid>
          <StatCard
            label="Hours this week"
            value={(summary?.weeklyMinutes ?? 0) / 60}
            suffix="h"
            icon={<Timer />}
            accent="brand"
            footer={formatMinutes(summary?.weeklyMinutes ?? 0)}
          />
          <StatCard
            label="Attendance (30 days)"
            value={Math.round((summary?.monthlyAttendanceRate ?? 0) * 100)}
            suffix="%"
            icon={<CalendarDays />}
            accent="success"
            footer={`${summary?.monthlyAttendedDays ?? 0} of ${summary?.monthlyWorkingDays ?? 0} working days`}
          />
          <StatCard
            label="Open tasks"
            value={summary?.openTasks ?? 0}
            icon={<ListTodo />}
            accent="info"
            footer="Assigned to you"
          />
          <StatCard
            label="Overdue"
            value={summary?.overdueTasks ?? 0}
            icon={<CalendarClock />}
            accent="critical"
            invertDelta
            footer="Past the due date"
          />
        </StatGrid>

        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Today&apos;s tasks</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Your open work, soonest deadline first.
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/app/tasks?scope=mine">View all</Link>
              </Button>
            </CardHeader>
            <CardContent flush>
              {myTasks.items.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 />}
                  title="Nothing on your plate"
                  description="You have no open tasks assigned. Enjoy it while it lasts."
                  action={
                    <Button size="sm" variant="secondary" asChild>
                      <Link href="/app/tasks">Browse the board</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {myTasks.items.map((task) => (
                    <TaskListItem key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <QuickAction href="/app/tasks?scope=mine" icon={<ListTodo />} label="My tasks" />
                <QuickAction href="/app/attendance/my" icon={<CalendarDays />} label="Attendance" />
                <QuickAction href="/app/leave" icon={<Plane />} label="Request leave" />
                <QuickAction href="/app/locations" icon={<MapPin />} label="My office" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>This month</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3.5">
                <Row label="Hours worked" value={formatMinutes(summary?.monthlyMinutes ?? 0)} />
                <Row
                  label="Attendance rate"
                  value={formatPercent(summary?.monthlyAttendanceRate ?? 0)}
                />
                <Row label="Days attended" value={String(summary?.monthlyAttendedDays ?? 0)} />
                <Row label="Tasks completed" value={String(summary?.completedTasks ?? 0)} />
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-start gap-2 rounded-xl border border-line bg-surface-2/50 p-3.5 transition-colors hover:border-brand/40 hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <span
        className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:size-[1.125rem]"
        aria-hidden
      >
        {icon}
      </span>
      <span className="text-sm font-medium text-ink">{label}</span>
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold tabular text-ink">{value}</span>
    </div>
  );
}
