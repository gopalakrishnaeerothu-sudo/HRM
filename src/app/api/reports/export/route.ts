import { z } from "zod";

import { csvResponse, timestampedFilename, toCsv } from "@/lib/csv";
import { formatMinutes } from "@/lib/utils";
import { addDays, formatDate, zonedDateKey } from "@/lib/time";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { parseQuery, route } from "@/server/api/handler";
import { attendanceRepository } from "@/server/repositories/attendance-repository";
import { narrowScope, tenantScopeFor } from "@/server/services/access-service";
import { auditService } from "@/server/services/audit-service";
import { dashboardService } from "@/server/services/dashboard-service";

/**
 * GET /api/reports/export?report=…&days=…
 *
 * CSV export of the report tables.
 *
 * Two things worth noting:
 *  - The export runs through the same visibility envelope as the on-screen
 *    report, so it cannot be used to pull data a user cannot already see.
 *  - Every export is written to the audit log. Bulk extraction of people's
 *    attendance is exactly the action an administrator would later want to
 *    account for.
 */

const querySchema = z.object({
  report: z.enum(["working-hours", "attendance"]).default("working-hours"),
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export const GET = route({
  permission: "report:export",
  handler: async ({ session, request }) => {
    const { report, days } = parseQuery(request, querySchema);

    const timezone = session.organization.timezone;
    const to = zonedDateKey(new Date(), timezone);
    const from = addDays(to, -(days - 1));

    if (report === "working-hours") {
      const rows = await dashboardService.workingHoursReport(session, from, to);

      const csv = toCsv(rows, [
        { header: "Employee", value: (row) => row.name },
        { header: "Designation", value: (row) => row.designation },
        { header: "Department", value: (row) => row.department },
        { header: "Days worked", value: (row) => row.daysWorked },
        { header: "Total hours", value: (row) => (row.totalMinutes / 60).toFixed(2) },
        { header: "Total (h m)", value: (row) => formatMinutes(row.totalMinutes) },
        { header: "Average per day (h)", value: (row) => (row.averageMinutes / 60).toFixed(2) },
        { header: "Overtime hours", value: (row) => (row.overtimeMinutes / 60).toFixed(2) },
        { header: "Late days", value: (row) => row.lateDays },
      ]);

      await auditService.record(tenantScopeFor(session), session, {
        action: "EXPORT",
        entityType: "reports",
        summary: `Exported the working-hours report for ${rows.length} people (${formatDate(from)} – ${formatDate(to)})`,
      });

      return csvResponse(csv, timestampedFilename("working-hours"));
    }

    // Attendance register: one row per employee per day.
    const envelope = await narrowScope(session, "organization");
    const records = await attendanceRepository.list(
      tenantScopeFor(session),
      { employeeIds: envelope ?? undefined, from, to },
      1,
      // Bounded so a careless `days=366` cannot stream the entire table.
      5000,
    );

    const csv = toCsv(records.items, [
      { header: "Date", value: (row) => row.date.toISOString().slice(0, 10) },
      {
        header: "Employee",
        value: (row) => `${row.employee.firstName} ${row.employee.lastName}`,
      },
      { header: "Employee ID", value: (row) => row.employee.employeeCode },
      { header: "Department", value: (row) => row.employee.department?.name ?? "" },
      { header: "Office", value: (row) => row.office?.name ?? "" },
      { header: "Status", value: (row) => ATTENDANCE_STATUS_LABELS[row.status] },
      { header: "Check in", value: (row) => row.checkInAt?.toISOString() ?? "" },
      { header: "Check out", value: (row) => row.checkOutAt?.toISOString() ?? "" },
      { header: "Worked minutes", value: (row) => row.workedMinutes },
      { header: "Break minutes", value: (row) => row.breakMinutes },
      { header: "Overtime minutes", value: (row) => row.overtimeMinutes },
      { header: "Late by minutes", value: (row) => row.lateByMinutes },
      { header: "Manual entry", value: (row) => row.isManualEntry },
      { header: "Override reason", value: (row) => row.overrideReason ?? "" },
    ]);

    await auditService.record(tenantScopeFor(session), session, {
      action: "EXPORT",
      entityType: "attendance_records",
      summary: `Exported ${records.items.length} attendance records (${formatDate(from)} – ${formatDate(to)})`,
    });

    return csvResponse(csv, timestampedFilename("attendance"));
  },
});
