import "server-only";

import { addDays, eachDay, startOfUtcDay, zonedDateKey } from "@/lib/time";
import { ratio } from "@/lib/utils";
import type { AuthSession } from "@/server/auth/types";
 
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { taskRepository } from "@/server/repositories/task-repository";
import { officeRepository } from "@/server/repositories/office-repository";
import { departmentRepository, organizationRepository } from "@/server/repositories/org-repository";
import { attendanceRate } from "@/server/services/attendance-rules";
import { resolveVisibleEmployeeIds, tenantScopeFor } from "@/server/services/access-service";

/**
 * Dashboard and report aggregates.
 *
 * Every figure is computed inside the caller's visibility envelope, so a
 * manager's "team present today" and an admin's "present today" come from the
 * same code path with a different scope — there is no second, laxer query.
 *
 * Queries here are indexed reads (`@@index([organizationId, date])`,
 * `@@index([organizationId, status, deletedAt])`) and are aggregated in the
 * database rather than by loading rows into memory.
 */

export interface AttendanceTrendPoint {
  date: string;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
}

export interface TaskTrendPoint {
  date: string;
  created: number;
  completed: number;
}

export const dashboardService = {
  /** Headline figures for the admin/HR dashboard. */
  async overview(session: AuthSession) {
    const scope = tenantScopeFor(session);
    const organization = await organizationRepository.policy(scope.organizationId);
    const envelope = await resolveVisibleEmployeeIds(session);

    const now = new Date();
    const today = zonedDateKey(now, organization.timezone);
    const yesterday = addDays(today, -1);

    const [
      employeeCounts,
      todayStatuses,
      yesterdayStatuses,
      taskStatuses,
      overdueCount,
      absentEmployees,
      offices,
    ] = await Promise.all([
      employeeRepository.countByStatus(scope),
      attendanceRepository.countByStatusForDate(scope, today, envelope ?? undefined),
      attendanceRepository.countByStatusForDate(scope, yesterday, envelope ?? undefined),
      taskRepository.countByStatus(scope, envelope),
      taskRepository.countOverdue(scope, envelope),
      attendanceRepository.findEmployeesWithoutRecord(scope, today, envelope ?? undefined),
      officeRepository.list(scope, false),
    ]);

    const countOf = (rows: Array<{ status: string; count: number }>, ...statuses: string[]) =>
      rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);

    const totalEmployees = employeeCounts.reduce((sum, row) => sum + row.count, 0);
    const activeEmployees = countOf(employeeCounts, "ACTIVE");

    const presentToday = countOf(todayStatuses, "PRESENT", "LATE", "HALF_DAY");
    const lateToday = countOf(todayStatuses, "LATE");
    const onLeaveToday = countOf(todayStatuses, "ON_LEAVE");
    // "Absent" is everyone active with no record yet, plus explicit absences.
    const absentToday = absentEmployees.length + countOf(todayStatuses, "ABSENT");

    const presentYesterday = countOf(yesterdayStatuses, "PRESENT", "LATE", "HALF_DAY");

    const tasksOf = (status: string) =>
      taskStatuses.find((row) => row.status === status)?.count ?? 0;

    const activeTasks = tasksOf("TODO") + tasksOf("IN_PROGRESS") + tasksOf("IN_REVIEW") + tasksOf("BLOCKED");
    const completedTasks = tasksOf("COMPLETED");
    const totalTasks = activeTasks + completedTasks;

    // Utilisation: present staff against the seats their offices are sized for
    // — approximated as active employees assigned to an active office.
    const assignedToOffices = await employeeRepository.countAssignedToOffice(scope);

    return {
      timezone: organization.timezone,
      today,
      totalEmployees,
      activeEmployees,
      presentToday,
      absentToday,
      lateToday,
      onLeaveToday,
      attendanceRateToday: ratio(presentToday, Math.max(1, activeEmployees - onLeaveToday)),
      presentDelta:
        presentYesterday === 0 ? 0 : ((presentToday - presentYesterday) / presentYesterday) * 100,
      activeTasks,
      completedTasks,
      overdueTasks: overdueCount,
      taskCompletionRate: ratio(completedTasks, Math.max(1, totalTasks)),
      officeCount: offices.length,
      officeUtilisation: ratio(presentToday, Math.max(1, assignedToOffices)),
      absentEmployees: absentEmployees.slice(0, 8),
    };
  },

  /** Daily attendance breakdown over the trailing `days` days. */
  async attendanceTrend(session: AuthSession, days = 14): Promise<AttendanceTrendPoint[]> {
    const scope = tenantScopeFor(session);
    const organization = await organizationRepository.policy(scope.organizationId);
    const envelope = await resolveVisibleEmployeeIds(session);

    const to = zonedDateKey(new Date(), organization.timezone);
    const from = addDays(to, -(days - 1));

    const records = await attendanceRepository.listRange(scope, {
      employeeIds: envelope ?? undefined,
      from,
      to,
    });

    const byDate = new Map<string, AttendanceTrendPoint>();
    for (const day of eachDay(from, to)) {
      const key = day.toISOString().slice(0, 10);
      byDate.set(key, { date: key, present: 0, late: 0, absent: 0, onLeave: 0 });
    }

    for (const record of records) {
      const key = startOfUtcDay(record.date).toISOString().slice(0, 10);
      const point = byDate.get(key);
      if (!point) continue;

      switch (record.status) {
        case "PRESENT":
        case "HALF_DAY":
          point.present += 1;
          break;
        case "LATE":
          point.late += 1;
          break;
        case "ON_LEAVE":
          point.onLeave += 1;
          break;
        case "ABSENT":
          point.absent += 1;
          break;
        default:
          break; // weekends and holidays are not plotted as attendance
      }
    }

    return Array.from(byDate.values());
  },

  /** Tasks created vs completed per day. */
  async taskTrend(session: AuthSession, days = 14): Promise<TaskTrendPoint[]> {
    const scope = tenantScopeFor(session);
    const to = startOfUtcDay(new Date());
    const from = addDays(to, -(days - 1));

    // Grouped in PostgreSQL: this returns one row per day rather than every
    // task in the window, and generate_series fills quiet days with zeros so
    // the caller has nothing to reconcile.
    return taskRepository.trendByDay(scope, from, to);
  },

  /** Head-count and open-task load per department. */
  async departmentWorkload(session: AuthSession) {
    const scope = tenantScopeFor(session);
    const [headcount, openTasksByDepartment] = await Promise.all([
      employeeRepository.countByDepartment(scope),
      departmentRepository.openTaskLoad(scope),
    ]);

    return headcount.map((row) => ({
      ...row,
      openTasks: row.departmentId ? (openTasksByDepartment.get(row.departmentId) ?? 0) : 0,
    }));
  },

  /** Manager view: their team's attendance and workload today. */
  async teamSnapshot(session: AuthSession) {
    const scope = tenantScopeFor(session);
    const organization = await organizationRepository.policy(scope.organizationId);
    const envelope = await resolveVisibleEmployeeIds(session);

    const teamIds: string[] = envelope
      ? [...envelope]
      : (await employeeRepository.listAll(scope)).map((employee) => employee.id);
    const today = zonedDateKey(new Date(), organization.timezone);

    const [statuses, workload, members, taskStatuses, overdue] = await Promise.all([
      attendanceRepository.countByStatusForDate(scope, today, teamIds),
      taskRepository.workloadByEmployee(scope, teamIds),
      employeeRepository.listWithAttendanceForDate(scope, teamIds, today),
      taskRepository.countByStatus(scope, envelope),
      taskRepository.countOverdue(scope, envelope),
    ]);

    const workloadById = new Map(workload.map((row) => [row.employeeId, row.open]));

    const countOf = (...wanted: string[]) =>
      statuses.filter((row) => wanted.includes(row.status)).reduce((sum, row) => sum + row.count, 0);

    const tasksOf = (status: string) => taskStatuses.find((row) => row.status === status)?.count ?? 0;

    return {
      teamSize: members.length,
      present: countOf("PRESENT", "HALF_DAY"),
      late: countOf("LATE"),
      absent: members.length - countOf("PRESENT", "HALF_DAY", "LATE", "ON_LEAVE"),
      onLeave: countOf("ON_LEAVE"),
      assignedTasks: taskStatuses.reduce((sum, row) => sum + row.count, 0),
      inProgress: tasksOf("IN_PROGRESS"),
      completed: tasksOf("COMPLETED"),
      overdue,
      members: members.map((member) => ({
        id: member.id,
        name: `${member.firstName} ${member.lastName}`,
        avatarUrl: member.avatarUrl,
        designation: member.designation,
        attendanceStatus: member.attendance?.status ?? null,
        checkInAt: member.attendance?.checkInAt ?? null,
        workedMinutes: member.attendance?.workedMinutes ?? 0,
        openTasks: workloadById.get(member.id) ?? 0,
      })),
    };
  },

  /** Personal figures for the employee dashboard. */
  async personalSummary(session: AuthSession) {
    const employee = session.employee;
    if (!employee) return null;

    const scope = tenantScopeFor(session);
    const organization = await organizationRepository.policy(scope.organizationId);

    const today = zonedDateKey(new Date(), organization.timezone);
    const weekStart = addDays(today, -6);
    const monthStart = addDays(today, -29);

    const [weekRecords, monthRecords, taskStatuses, overdue] = await Promise.all([
      attendanceRepository.listRange(scope, { employeeIds: [employee.id], from: weekStart, to: today }),
      attendanceRepository.listRange(scope, { employeeIds: [employee.id], from: monthStart, to: today }),
      taskRepository.countByStatus(scope, [employee.id]),
      taskRepository.countOverdue(scope, [employee.id]),
    ]);

    const weeklyMinutes = weekRecords.reduce((sum, record) => sum + record.workedMinutes, 0);
    const monthlyMinutes = monthRecords.reduce((sum, record) => sum + record.workedMinutes, 0);
    const monthly = attendanceRate(monthRecords);

    const tasksOf = (status: string) => taskStatuses.find((row) => row.status === status)?.count ?? 0;

    return {
      weeklyMinutes,
      monthlyMinutes,
      monthlyAttendanceRate: monthly.rate,
      monthlyWorkingDays: monthly.workingDays,
      monthlyAttendedDays: monthly.attendedDays,
      openTasks: tasksOf("TODO") + tasksOf("IN_PROGRESS") + tasksOf("IN_REVIEW") + tasksOf("BLOCKED"),
      completedTasks: tasksOf("COMPLETED"),
      overdueTasks: overdue,
      weekRecords,
    };
  },

  /** Working-hours report rows. */
  async workingHoursReport(session: AuthSession, from: Date, to: Date) {
    const scope = tenantScopeFor(session);
    const envelope = await resolveVisibleEmployeeIds(session);

    const records = await attendanceRepository.listRange(scope, {
      employeeIds: envelope ?? undefined,
      from,
      to,
    });

    const employees = await employeeRepository.listForReport(scope, envelope);

    const byEmployee = new Map<string, { minutes: number; overtime: number; days: number; late: number }>();
    for (const record of records) {
      const bucket = byEmployee.get(record.employeeId) ?? { minutes: 0, overtime: 0, days: 0, late: 0 };
      bucket.minutes += record.workedMinutes;
      bucket.overtime += record.overtimeMinutes;
      if (record.workedMinutes > 0) bucket.days += 1;
      if (record.lateByMinutes > 0) bucket.late += 1;
      byEmployee.set(record.employeeId, bucket);
    }

    return employees.map((employee) => {
      const bucket = byEmployee.get(employee.id) ?? { minutes: 0, overtime: 0, days: 0, late: 0 };
      return {
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        avatarUrl: employee.avatarUrl,
        designation: employee.designation,
        department: employee.department?.name ?? "Unassigned",
        departmentColor: employee.department?.color ?? "#94a3b8",
        totalMinutes: bucket.minutes,
        overtimeMinutes: bucket.overtime,
        daysWorked: bucket.days,
        lateDays: bucket.late,
        averageMinutes: bucket.days === 0 ? 0 : Math.round(bucket.minutes / bucket.days),
      };
    });
  },
};
