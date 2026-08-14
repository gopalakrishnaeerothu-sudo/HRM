import Link from "next/link";
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, ListTodo, UserMinus, Users } from "lucide-react";

import { formatMinutes } from "@/lib/utils";
import { formatTime } from "@/lib/time";
import type { AuthSession } from "@/server/auth/types";
import { ATTENDANCE_STATUS_TONE } from "@/server/services/attendance-rules";
import { dashboardService } from "@/server/services/dashboard-service";
import { taskService } from "@/server/services/task-service";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from "@/components/ui/table";
import { AttendanceTrendChart } from "@/components/charts/attendance-trend-chart";
import { TaskListItem } from "@/components/tasks/task-list-item";

/**
 * Manager dashboard.
 *
 * Every figure here is bounded by `resolveVisibleEmployeeIds`, which for a
 * MANAGER is: themselves, their report tree, and the members of teams they
 * actually manage. Merely belonging to a team does not widen the view.
 */
export async function ManagerDashboard({ session }: { session: AuthSession }) {
  const [snapshot, attendanceTrend, overdueTasks, upcomingTasks] = await Promise.all([
    dashboardService.teamSnapshot(session),
    dashboardService.attendanceTrend(session, 14),
    taskService.list(session, {
      page: 1,
      pageSize: 5,
      scope: "all",
      overdue: true,
      sortBy: "dueDate",
      sortOrder: "asc",
    }),
    taskService.list(session, {
      page: 1,
      pageSize: 5,
      scope: "all",
      status: ["TODO", "IN_PROGRESS", "IN_REVIEW"],
      sortBy: "dueDate",
      sortOrder: "asc",
    }),
  ]);

  return (
    <>
      <PageHeader
        title="My team"
        description={`${snapshot.teamSize} people reporting into you across ${session.organization.name}.`}
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/app/attendance">Team attendance</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/app/tasks/new">New task</Link>
            </Button>
          </>
        }
      />

      <PageBody>
        <StatGrid>
          <StatCard label="Team size" value={snapshot.teamSize} icon={<Users />} accent="brand" footer="Direct and indirect reports" />
          <StatCard label="Present" value={snapshot.present} icon={<CalendarCheck />} accent="success" footer="Checked in today" />
          <StatCard label="Late" value={snapshot.late} icon={<Clock />} accent="warning" footer="After the grace period" />
          <StatCard label="Absent" value={snapshot.absent} icon={<UserMinus />} accent="critical" footer={`${snapshot.onLeave} on leave`} />
        </StatGrid>

        <StatGrid>
          <StatCard label="Assigned tasks" value={snapshot.assignedTasks} icon={<ListTodo />} accent="info" footer="Across the team" />
          <StatCard label="In progress" value={snapshot.inProgress} icon={<ListTodo />} accent="brand" footer="Being worked on now" />
          <StatCard label="Completed" value={snapshot.completed} icon={<CheckCircle2 />} accent="success" footer="All time" />
          <StatCard label="Overdue" value={snapshot.overdue} icon={<AlertTriangle />} accent="critical" invertDelta footer="Needs attention" />
        </StatGrid>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <AttendanceTrendChart data={attendanceTrend} />

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Overdue tasks</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">Past their due date and still open.</p>
              </div>
            </CardHeader>
            <CardContent flush>
              {overdueTasks.items.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 />}
                  title="Nothing overdue"
                  description="Every task in your team is on schedule."
                />
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {overdueTasks.items.map((task) => (
                    <TaskListItem key={task.id} task={task} compact />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Team today</CardTitle>
              <p className="mt-1 text-sm text-ink-muted">
                Attendance status and current workload, per person.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app/employees">View all</Link>
            </Button>
          </CardHeader>

          <CardContent flush>
            {snapshot.members.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="No reports yet"
                description="Once employees are assigned to you, their attendance and workload appear here."
              />
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead numeric>Hours today</TableHead>
                      <TableHead className="min-w-[9rem]">Open tasks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshot.members.map((member) => {
                      const status = member.attendanceStatus;
                      const maxLoad = Math.max(
                        6,
                        ...snapshot.members.map((entry) => entry.openTasks),
                      );

                      return (
                        <TableRow key={member.id}>
                          <TableCell>
                            <Link
                              href={`/app/employees/${member.id}`}
                              className="flex min-w-0 items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                            >
                              <Avatar name={member.name} src={member.avatarUrl} size="sm" />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-ink">{member.name}</span>
                                <span className="block truncate text-xs text-ink-muted">
                                  {member.designation}
                                </span>
                              </span>
                            </Link>
                          </TableCell>

                          <TableCell>
                            {status ? (
                              <Badge tone={ATTENDANCE_STATUS_TONE[status]} size="sm">
                                {ATTENDANCE_STATUS_LABELS[status]}
                              </Badge>
                            ) : (
                              <Badge tone="neutral" size="sm">
                                Not checked in
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="text-ink-secondary">
                            {member.checkInAt
                              ? formatTime(member.checkInAt, session.organization.timezone)
                              : "—"}
                          </TableCell>

                          <TableCell numeric className="text-ink-secondary">
                            {member.workedMinutes > 0 ? formatMinutes(member.workedMinutes) : "—"}
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Progress
                                value={(member.openTasks / maxLoad) * 100}
                                barSize="sm"
                                tone={member.openTasks > 6 ? "warning" : "brand"}
                                label={`${member.name} workload`}
                                className="w-20"
                              />
                              <span className="shrink-0 text-xs tabular text-ink-secondary">
                                {member.openTasks}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Upcoming deadlines</CardTitle>
              <p className="mt-1 text-sm text-ink-muted">The next tasks due across your team.</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app/tasks">All tasks</Link>
            </Button>
          </CardHeader>
          <CardContent flush>
            {upcomingTasks.items.length === 0 ? (
              <EmptyState icon={<ListTodo />} title="No open tasks" description="Your team's board is clear." />
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {upcomingTasks.items.map((task) => (
                  <TaskListItem key={task.id} task={task} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
