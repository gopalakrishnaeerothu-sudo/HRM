import type { AttendanceStatus } from "@/server/db/types";

import { cn, formatMinutes } from "@/lib/utils";
import { formatDayLabel } from "@/lib/time";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Seven-day attendance strip.
 *
 * Status is carried by a letter as well as a colour, so the strip is readable
 * without colour vision; the full label is in the tooltip and the accessible
 * name of each cell.
 */

interface DayRecord {
  date: Date;
  status: AttendanceStatus;
  workedMinutes: number;
}

const CELL_STYLE: Record<AttendanceStatus, { className: string; letter: string }> = {
  PRESENT: { className: "bg-success text-white", letter: "P" },
  LATE: { className: "bg-warning text-white", letter: "L" },
  HALF_DAY: { className: "bg-serious text-white", letter: "½" },
  ABSENT: { className: "bg-critical text-white", letter: "A" },
  ON_LEAVE: { className: "bg-info text-white", letter: "V" },
  HOLIDAY: { className: "bg-brand text-white", letter: "H" },
  WEEKEND: { className: "bg-surface-3 text-ink-muted", letter: "—" },
};

export function WeekStrip({
  records,
  timezone,
}: {
  records: Array<{ date: Date; status: AttendanceStatus; workedMinutes: number }>;
  timezone: string;
}) {
  if (records.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No attendance recorded in the last seven days.
      </p>
    );
  }

  const totalMinutes = records.reduce((sum, record) => sum + record.workedMinutes, 0);
  const maxMinutes = Math.max(60, ...records.map((record) => record.workedMinutes));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-1.5">
        {records.map((record: DayRecord) => {
          const style = CELL_STYLE[record.status];
          const label = `${formatDayLabel(record.date, timezone)} — ${ATTENDANCE_STATUS_LABELS[record.status]}${
            record.workedMinutes > 0 ? `, ${formatMinutes(record.workedMinutes)}` : ""
          }`;

          return (
            <Tooltip key={record.date.toISOString()} content={label}>
              <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
                {/* Bar height encodes hours; the tile below encodes status. */}
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className={cn(
                      "w-full max-w-8 rounded-t-[4px] transition-[height] duration-500",
                      record.workedMinutes > 0 ? "bg-brand/70" : "bg-surface-3",
                    )}
                    style={{
                      height: `${Math.max(6, (record.workedMinutes / maxMinutes) * 100)}%`,
                    }}
                  />
                </div>

                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-[0.6875rem] font-semibold",
                    style.className,
                  )}
                  aria-hidden
                >
                  {style.letter}
                </span>

                <span className="w-full truncate text-center text-[0.625rem] text-ink-muted">
                  {formatDayLabel(record.date, timezone).split(",")[0]}
                </span>

                <span className="sr-only">{label}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-ink-muted">Total this week</span>
        <span className="text-lg font-semibold tabular text-ink">{formatMinutes(totalMinutes)}</span>
      </div>
    </div>
  );
}
