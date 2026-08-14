import type { Metadata } from "next";
import { CalendarDays, Clock, Timer, TrendingUp } from "lucide-react";

import { formatMinutes } from "@/lib/utils";
import { addDays, formatDate, formatTime, zonedDateKey } from "@/lib/time";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { requireEmployeeSession } from "@/server/auth";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { attendanceService } from "@/server/services/attendance-service";
import { dashboardService } from "@/server/services/dashboard-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { ATTENDANCE_STATUS_TONE, attendanceRate } from "@/server/services/attendance-rules";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
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
import { CheckInPanel } from "@/components/attendance/check-in-panel";
import { AttendanceCalendar } from "@/components/attendance/attendance-calendar";

export const metadata: Metadata = { title: "My attendance" };

/**
 * The employee's own attendance: today's check-in control, a month calendar,
 * and the day-by-day record. Scoped to the signed-in employee by construction —
 * the employee id comes from the session, never from the URL.
 */
export default async function MyAttendancePage() {
  const session = await requireEmployeeSession();
  const scope = tenantScopeFor(session);

  const [today, summary] = await Promise.all([
    attendanceService.todayFor(session),
    dashboardService.personalSummary(session),
  ]);

  const todayKey = zonedDateKey(new Date(), today.timezone);
  const from = addDays(todayKey, -34);

  const [history, monthRecords] = await Promise.all([
    attendanceRepository.list(scope, { employeeIds: [session.employee.id], from, to: todayKey }, 1, 35),
    attendanceRepository.listRange(scope, {
      employeeIds: [session.employee.id],
      from,
      to: todayKey,
    }),
  ]);

  const rate = attendanceRate(history.items);
  const overtimeMinutes = history.items.reduce((sum, record) => sum + record.overtimeMinutes, 0);
  const lateDays = history.items.filter((record) => record.lateByMinutes > 0).length;

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Your check-ins, hours and history. Location is verified on the server at each check-in."
      />

      <PageBody>
        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
          <CheckInPanel
            officeName={today.zones[0]?.officeName ?? null}
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
                <CardTitle>Today&apos;s timeline</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Every event, with the location verdict the server recorded.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {!today.record || today.record.events.length === 0 ? (
                <p className="py-10 text-center text-sm text-ink-muted">
                  Nothing recorded yet today.
                </p>
              ) : (
                <ol className="relative flex flex-col gap-4 pl-5">
                  <span className="absolute bottom-2 left-[0.3125rem] top-2 w-px bg-line" aria-hidden />
                  {today.record.events.map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        className={`absolute -left-5 top-1.5 size-2.5 rounded-full ring-2 ring-surface-1 ${
                          event.verification === "VERIFIED"
                            ? "bg-success"
                            : event.verification === "NO_LOCATION"
                              ? "bg-ink-muted"
                              : "bg-critical"
                        }`}
                        aria-hidden
                      />
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="text-sm font-medium text-ink">
                          {event.type.replace("_", " ").toLowerCase()}
                        </p>
                        <p className="text-xs tabular text-ink-muted">
                          {formatTime(event.occurredAt, today.timezone)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {event.office?.name ?? "No office"}
                        {event.distanceMeters !== null
                          ? ` · ${Math.round(event.distanceMeters)} m from centre`
                          : ""}
                        {event.accuracyMeters !== null
                          ? ` · ±${Math.round(event.accuracyMeters)} m accuracy`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
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
            label="Attendance rate"
            value={Math.round(rate.rate * 100)}
            suffix="%"
            icon={<TrendingUp />}
            accent="success"
            footer={`${rate.attendedDays} of ${rate.workingDays} working days`}
          />
          <StatCard
            label="Overtime"
            value={overtimeMinutes / 60}
            suffix="h"
            icon={<Clock />}
            accent="info"
            footer="Beyond your full-day target"
          />
          <StatCard
            label="Late arrivals"
            value={lateDays}
            icon={<CalendarDays />}
            accent="warning"
            invertDelta
            footer="After the grace period"
          />
        </StatGrid>

        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Monthly calendar</CardTitle>
              <p className="mt-1 text-sm text-ink-muted">
                Each day is marked with its status letter as well as its colour.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <AttendanceCalendar
              records={monthRecords.map((record) => ({
                date: record.date,
                status: record.status,
                workedMinutes: record.workedMinutes,
              }))}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>

          {history.items.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title="No attendance yet"
              description="Once you check in, your daily records appear here."
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
                    <TableHead numeric>Break</TableHead>
                    <TableHead numeric>Late by</TableHead>
                    <TableHead>Office</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.items.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(record.date)}</TableCell>
                      <TableCell>
                        <Badge tone={ATTENDANCE_STATUS_TONE[record.status]} size="sm">
                          {ATTENDANCE_STATUS_LABELS[record.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {record.checkInAt ? formatTime(record.checkInAt, today.timezone) : "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {record.checkOutAt ? formatTime(record.checkOutAt, today.timezone) : "—"}
                      </TableCell>
                      <TableCell numeric className="text-ink-secondary">
                        {record.workedMinutes > 0 ? formatMinutes(record.workedMinutes) : "—"}
                      </TableCell>
                      <TableCell numeric className="text-ink-secondary">
                        {record.breakMinutes > 0 ? formatMinutes(record.breakMinutes) : "—"}
                      </TableCell>
                      <TableCell numeric className="text-ink-secondary">
                        {record.lateByMinutes > 0 ? `${record.lateByMinutes}m` : "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">{record.office?.name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
