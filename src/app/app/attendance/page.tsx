import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CalendarDays, Clock, ShieldAlert, UserMinus } from "lucide-react";

import { formatMinutes } from "@/lib/utils";
import { addDays, formatDate, formatDateTime, formatTime, zonedDateKey } from "@/lib/time";
import { attendanceQuerySchema, ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { can, requirePagePermission } from "@/server/auth";
import { RISK_FLAG_LABELS, type GeoRiskFlag } from "@/server/geo/verify";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { narrowScope, tenantScopeFor } from "@/server/services/access-service";
import { ATTENDANCE_STATUS_TONE } from "@/server/services/attendance-rules";
import { dashboardService } from "@/server/services/dashboard-service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { AttendanceTrendChart } from "@/components/charts/attendance-trend-chart";
import { AttendanceOverrideDialog } from "@/components/attendance/override-dialog";

export const metadata: Metadata = { title: "Attendance" };

/**
 * Team / organisation attendance.
 *
 * The visible employee set comes from `narrowScope`, so a manager sees their
 * tree and an HR user sees everyone — from the same query, with a different
 * envelope. A manager cannot widen it by editing the URL.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePagePermission("attendance:read:team");
  const scope = tenantScopeFor(session);
  const params = await searchParams;

  const parsed = attendanceQuerySchema.safeParse({ ...params, scope: params.scope ?? "team" });
  const query = parsed.success ? parsed.data : attendanceQuerySchema.parse({ scope: "team" });

  const envelope = await narrowScope(session, query.scope);
  const timezone = session.organization.timezone;
  const today = zonedDateKey(new Date(), timezone);
  const from = query.from ?? addDays(today, -13);
  const to = query.to ?? today;

  const canOverride = can(session, "attendance:override");

  const [records, trend, todayStatuses, flagged] = await Promise.all([
    attendanceRepository.list(
      scope,
      { employeeIds: envelope ?? undefined, from, to, status: query.status },
      query.page,
      query.pageSize,
    ),
    dashboardService.attendanceTrend(session, 14),
    attendanceRepository.countByStatusForDate(scope, today, envelope ?? undefined),
    canOverride ? attendanceRepository.listFlaggedEvents(scope, 15) : Promise.resolve([]),
  ]);

  const countOf = (...statuses: string[]) =>
    todayStatuses.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`${formatDate(from)} – ${formatDate(to)} · ${records.total} records.`}
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/app/attendance/my">My attendance</Link>
          </Button>
        }
      />

      <PageBody>
        <StatGrid>
          <StatCard
            label="Present today"
            value={countOf("PRESENT", "HALF_DAY", "LATE")}
            icon={<CalendarCheck />}
            accent="success"
            footer="Checked in"
          />
          <StatCard label="Late today" value={countOf("LATE")} icon={<Clock />} accent="warning" footer="After grace period" />
          <StatCard label="Absent today" value={countOf("ABSENT")} icon={<UserMinus />} accent="critical" footer="No check-in recorded" />
          <StatCard label="On leave" value={countOf("ON_LEAVE")} icon={<CalendarDays />} accent="info" footer="Approved leave" />
        </StatGrid>

        <AttendanceTrendChart data={trend} />

        <Tabs defaultValue="records">
          <TabsList>
            <TabsTrigger value="records">
              <CalendarDays aria-hidden />
              Records
            </TabsTrigger>
            {flagged.length > 0 ? (
              <TabsTrigger value="flagged">
                <ShieldAlert aria-hidden />
                Location review
                <Badge tone="critical" size="sm">
                  {flagged.length}
                </Badge>
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="records">
            <Card className="overflow-hidden">
              {records.items.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays />}
                  title="No attendance in this range"
                  description="Nothing was recorded for the selected people and dates."
                />
              ) : (
                <>
                  <TableWrap>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>In</TableHead>
                          <TableHead>Out</TableHead>
                          <TableHead numeric>Worked</TableHead>
                          <TableHead>Office</TableHead>
                          {canOverride ? (
                            <TableHead className="w-14 text-right">
                              <span className="sr-only">Correct</span>
                            </TableHead>
                          ) : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.items.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>
                              <Link
                                href={`/app/employees/${record.employee.id}`}
                                className="flex min-w-0 items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                              >
                                <Avatar
                                  name={`${record.employee.firstName} ${record.employee.lastName}`}
                                  src={record.employee.avatarUrl}
                                  size="sm"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-ink">
                                    {record.employee.firstName} {record.employee.lastName}
                                  </span>
                                  <span className="block truncate text-xs text-ink-muted">
                                    {record.employee.department?.name ?? record.employee.designation}
                                  </span>
                                </span>
                              </Link>
                            </TableCell>

                            <TableCell className="whitespace-nowrap">{formatDate(record.date)}</TableCell>

                            <TableCell>
                              <span className="flex items-center gap-1.5">
                                <Badge tone={ATTENDANCE_STATUS_TONE[record.status]} size="sm">
                                  {ATTENDANCE_STATUS_LABELS[record.status]}
                                </Badge>
                                {record.isManualEntry ? (
                                  <Badge tone="outline" size="sm">
                                    Manual
                                  </Badge>
                                ) : null}
                              </span>
                            </TableCell>

                            <TableCell className="text-ink-secondary">
                              {record.checkInAt ? formatTime(record.checkInAt, timezone) : "—"}
                            </TableCell>
                            <TableCell className="text-ink-secondary">
                              {record.checkOutAt ? formatTime(record.checkOutAt, timezone) : "—"}
                            </TableCell>
                            <TableCell numeric className="text-ink-secondary">
                              {record.workedMinutes > 0 ? formatMinutes(record.workedMinutes) : "—"}
                            </TableCell>
                            <TableCell className="text-ink-secondary">
                              {record.office?.name ?? "—"}
                            </TableCell>

                            {canOverride ? (
                              <TableCell className="text-right">
                                <AttendanceOverrideDialog
                                  target={{
                                    employeeId: record.employee.id,
                                    employeeName: `${record.employee.firstName} ${record.employee.lastName}`,
                                    date: record.date.toISOString().slice(0, 10),
                                    currentStatus: record.status,
                                    checkInAt: record.checkInAt?.toISOString() ?? null,
                                    checkOutAt: record.checkOutAt?.toISOString() ?? null,
                                  }}
                                />
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableWrap>

                  {records.pageCount > 1 ? (
                    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                      <p className="text-sm text-ink-muted">
                        Page {records.page} of {records.pageCount}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" disabled={records.page <= 1} asChild>
                          <Link href={`/app/attendance?page=${records.page - 1}`}>Previous</Link>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={records.page >= records.pageCount}
                          asChild
                        >
                          <Link href={`/app/attendance?page=${records.page + 1}`}>Next</Link>
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </TabsContent>

          {flagged.length > 0 ? (
            <TabsContent value="flagged">
              <Card>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>Check-ins needing review</CardTitle>
                    <p className="mt-1 text-sm text-ink-muted">
                      Attempts the server refused or accepted with a risk flag. Every attempt is
                      logged, whether or not it succeeded.
                    </p>
                  </div>
                </CardHeader>
                <CardContent flush>
                  <ul className="divide-y divide-[var(--line)] border-t border-line">
                    {flagged.map((event) => {
                      const flags = event.riskFlags as GeoRiskFlag[];
                      const refused = event.verification === "OUTSIDE_GEOFENCE";

                      return (
                        <li key={event.id} className="flex flex-wrap gap-3 px-5 py-4 sm:px-6">
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
                                {refused ? "Refused" : event.verification.replace(/_/g, " ").toLowerCase()}
                              </Badge>
                              <Badge tone="outline" size="sm">
                                {event.type.replace("_", " ").toLowerCase()}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-ink-muted">
                              {formatDateTime(event.occurredAt, timezone)} ·{" "}
                              {event.office?.name ?? "No office matched"}
                              {event.distanceMeters !== null
                                ? ` · ${Math.round(event.distanceMeters)} m from centre`
                                : ""}
                              {event.accuracyMeters !== null
                                ? ` · ±${Math.round(event.accuracyMeters)} m accuracy`
                                : ""}
                            </p>
                            {flags.length > 0 ? (
                              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                {flags.map((flag) => (
                                  <li key={flag}>
                                    <Badge tone="neutral" size="sm">
                                      {RISK_FLAG_LABELS[flag] ?? flag}
                                    </Badge>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
          ) : null}
        </Tabs>
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
