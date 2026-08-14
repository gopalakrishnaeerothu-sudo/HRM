import type { Metadata } from "next";
import { BarChart3, Clock, Download, TrendingUp, Users } from "lucide-react";

import { formatMinutes } from "@/lib/utils";
import { addDays, formatDate, zonedDateKey } from "@/lib/time";
import { can, requirePagePermission } from "@/server/auth";
import { dashboardService } from "@/server/services/dashboard-service";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
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
import { AttendanceTrendChart, TaskTrendChart } from "@/components/charts/attendance-trend-chart";
import { DepartmentDistributionChart, WorkingHoursChart } from "@/components/charts/distribution-charts";

export const metadata: Metadata = { title: "Reports" };

/**
 * Reporting.
 *
 * Every figure is computed inside the caller's visibility envelope, so a
 * manager's report and an HR user's report run the same code with different
 * scope — there is no separate, laxer reporting query.
 *
 * Export is deliberately not wired up yet: the button is disabled with a
 * tooltip rather than present-and-broken. The data shape below is already what
 * a CSV writer would consume.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requirePagePermission("report:read");
  const { days } = await searchParams;

  const rangeDays = Math.min(90, Math.max(7, Number(days) || 30));
  const timezone = session.organization.timezone;
  const to = zonedDateKey(new Date(), timezone);
  const from = addDays(to, -(rangeDays - 1));

  const [attendanceTrend, taskTrend, departments, hours] = await Promise.all([
    dashboardService.attendanceTrend(session, Math.min(rangeDays, 30)),
    dashboardService.taskTrend(session, Math.min(rangeDays, 30)),
    dashboardService.departmentWorkload(session),
    dashboardService.workingHoursReport(session, from, to),
  ]);

  const totalMinutes = hours.reduce((sum, row) => sum + row.totalMinutes, 0);
  const overtimeMinutes = hours.reduce((sum, row) => sum + row.overtimeMinutes, 0);
  const totalLateDays = hours.reduce((sum, row) => sum + row.lateDays, 0);
  const staffWithHours = hours.filter((row) => row.daysWorked > 0);
  const averageMinutes =
    staffWithHours.length === 0
      ? 0
      : Math.round(
          staffWithHours.reduce((sum, row) => sum + row.averageMinutes, 0) / staffWithHours.length,
        );

  const attendedTotal = attendanceTrend.reduce(
    (sum, point) => sum + point.present + point.late,
    0,
  );
  const expectedTotal = attendanceTrend.reduce(
    (sum, point) => sum + point.present + point.late + point.absent,
    0,
  );

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${formatDate(from)} – ${formatDate(to)} · ${rangeDays} days`}
        actions={
          <>
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              {[7, 30, 90].map((option) => (
                <Button
                  key={option}
                  variant={rangeDays === option ? "secondary" : "ghost"}
                  size="xs"
                  asChild
                >
                  <a href={`/app/reports?days=${option}`}>{option}d</a>
                </Button>
              ))}
            </div>
            {can(session, "report:export") ? (
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" asChild>
                  {/* A plain link, so the browser handles the download and the
                      Content-Disposition header does its job. */}
                  <a href={`/api/reports/export?report=working-hours&days=${rangeDays}`} download>
                    <Download aria-hidden />
                    Hours CSV
                  </a>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/api/reports/export?report=attendance&days=${rangeDays}`} download>
                    <Download aria-hidden />
                    Attendance CSV
                  </a>
                </Button>
              </div>
            ) : null}
          </>
        }
      />

      <PageBody>
        <StatGrid>
          <StatCard
            label="Total hours"
            value={totalMinutes / 60}
            suffix="h"
            icon={<Clock />}
            accent="brand"
            footer={`Across ${staffWithHours.length} people`}
          />
          <StatCard
            label="Average per day"
            value={averageMinutes / 60}
            suffix="h"
            icon={<TrendingUp />}
            accent="info"
            footer={formatMinutes(averageMinutes)}
          />
          <StatCard
            label="Overtime"
            value={overtimeMinutes / 60}
            suffix="h"
            icon={<Clock />}
            accent="warning"
            footer="Beyond full-day targets"
          />
          <StatCard
            label="Attendance rate"
            value={Math.round((expectedTotal === 0 ? 0 : attendedTotal / expectedTotal) * 100)}
            suffix="%"
            icon={<Users />}
            accent="success"
            footer={`${totalLateDays} late days recorded`}
          />
        </StatGrid>

        <Tabs defaultValue="attendance">
          <TabsList>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="hours">Working hours</TabsTrigger>
          </TabsList>

          <TabsContent value="attendance">
            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
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
          </TabsContent>

          <TabsContent value="tasks">
            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <TaskTrendChart data={taskTrend} />
              <DepartmentDistributionChart
                title="Open tasks by department"
                description="Current workload distribution."
                data={departments.map((department) => ({
                  name: department.name,
                  count: department.openTasks,
                }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="hours">
            <div className="flex flex-col gap-4">
              <WorkingHoursChart
                data={hours.map((row) => ({
                  name: row.name,
                  hours: row.totalMinutes / 60,
                  overtimeHours: row.overtimeMinutes / 60,
                }))}
              />

              <Card className="overflow-hidden">
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>Working hours by employee</CardTitle>
                    <p className="mt-1 text-sm text-ink-muted">
                      Worked time excludes recorded breaks.
                    </p>
                  </div>
                </CardHeader>

                {hours.length === 0 ? (
                  <EmptyState
                    icon={<BarChart3 />}
                    title="Nothing to report"
                    description="No attendance was recorded in this period."
                  />
                ) : (
                  <TableWrap>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead numeric>Days</TableHead>
                          <TableHead numeric>Total</TableHead>
                          <TableHead numeric>Average</TableHead>
                          <TableHead numeric>Overtime</TableHead>
                          <TableHead numeric>Late days</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hours.map((row) => (
                          <TableRow key={row.employeeId}>
                            <TableCell>
                              <span className="flex min-w-0 items-center gap-3">
                                <Avatar name={row.name} src={row.avatarUrl} size="sm" />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-ink">
                                    {row.name}
                                  </span>
                                  <span className="block truncate text-xs text-ink-muted">
                                    {row.designation}
                                  </span>
                                </span>
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ background: row.departmentColor }}
                                  aria-hidden
                                />
                                <span className="truncate text-ink-secondary">{row.department}</span>
                              </span>
                            </TableCell>
                            <TableCell numeric className="text-ink-secondary">
                              {row.daysWorked}
                            </TableCell>
                            <TableCell numeric className="font-medium text-ink">
                              {formatMinutes(row.totalMinutes)}
                            </TableCell>
                            <TableCell numeric className="text-ink-secondary">
                              {row.daysWorked > 0 ? formatMinutes(row.averageMinutes) : "—"}
                            </TableCell>
                            <TableCell numeric className="text-ink-secondary">
                              {row.overtimeMinutes > 0 ? formatMinutes(row.overtimeMinutes) : "—"}
                            </TableCell>
                            <TableCell numeric className="text-ink-secondary">
                              {row.lateDays > 0 ? row.lateDays : "—"}
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
        </Tabs>
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
