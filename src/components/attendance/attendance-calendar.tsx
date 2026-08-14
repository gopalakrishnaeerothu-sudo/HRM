"use client";

import * as React from "react";
import type { AttendanceStatus } from "@prisma/client";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn, formatMinutes } from "@/lib/utils";
import { addDays, endOfMonth, startOfMonth, startOfUtcDay } from "@/lib/time";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Month view of attendance.
 *
 * Each day carries a status *letter* as well as a colour, and the full label is
 * in both the tooltip and the cell's accessible name — status is never
 * communicated by colour alone.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const DAY_STYLE: Record<AttendanceStatus, { className: string; letter: string }> = {
  PRESENT: { className: "bg-success text-white", letter: "P" },
  LATE: { className: "bg-warning text-white", letter: "L" },
  HALF_DAY: { className: "bg-serious text-white", letter: "½" },
  ABSENT: { className: "bg-critical text-white", letter: "A" },
  ON_LEAVE: { className: "bg-info text-white", letter: "V" },
  HOLIDAY: { className: "bg-brand text-white", letter: "H" },
  WEEKEND: { className: "bg-surface-3 text-ink-muted", letter: "·" },
};

const LEGEND: AttendanceStatus[] = ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "HOLIDAY"];

export function AttendanceCalendar({
  records,
}: {
  records: Array<{ date: Date; status: AttendanceStatus; workedMinutes: number }>;
}) {
  const [anchor, setAnchor] = React.useState(() => startOfMonth(new Date()));

  const byDate = React.useMemo(() => {
    const map = new Map<string, { status: AttendanceStatus; workedMinutes: number }>();
    for (const record of records) {
      map.set(startOfUtcDay(new Date(record.date)).toISOString().slice(0, 10), {
        status: record.status,
        workedMinutes: record.workedMinutes,
      });
    }
    return map;
  }, [records]);

  const { cells, monthLabel } = React.useMemo(() => {
    const first = startOfMonth(anchor);
    const last = endOfMonth(anchor);
    const firstWeekday = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
    const gridStart = addDays(first, 1 - firstWeekday);

    return {
      cells: Array.from({ length: 42 }, (_, index) => {
        const date = addDays(gridStart, index);
        return { date, inMonth: date >= first && date <= last };
      }),
      monthLabel: new Intl.DateTimeFormat("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(first),
    };
  }, [anchor]);

  const todayKey = startOfUtcDay(new Date()).toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAnchor((current) => startOfMonth(addDays(current, -1)))}
            aria-label="Previous month"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAnchor((current) => startOfMonth(addDays(endOfMonth(current), 1)))}
            aria-label="Next month"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((day, index) => (
            <div
              key={`${day}-${index}`}
              className="text-center text-[0.625rem] font-semibold uppercase text-ink-muted"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {cells.map(({ date, inMonth }) => {
            const key = date.toISOString().slice(0, 10);
            const record = byDate.get(key);
            const style = record ? DAY_STYLE[record.status] : null;
            const isToday = key === todayKey;

            const label = record
              ? `${key} — ${ATTENDANCE_STATUS_LABELS[record.status]}${
                  record.workedMinutes > 0 ? `, ${formatMinutes(record.workedMinutes)}` : ""
                }`
              : `${key} — no record`;

            return (
              <Tooltip key={key} content={label}>
                <div
                  className={cn(
                    "relative flex aspect-square items-center justify-center rounded-lg text-xs font-medium transition-transform",
                    !inMonth && "opacity-35",
                    style ? style.className : "border border-line bg-surface-2/50 text-ink-muted",
                    isToday && "ring-2 ring-brand ring-offset-2 ring-offset-[var(--surface-1)]",
                  )}
                >
                  <span className="tabular">{date.getUTCDate()}</span>
                  {style ? (
                    <span
                      className="absolute bottom-0.5 right-1 text-[0.5rem] font-bold opacity-80"
                      aria-hidden
                    >
                      {style.letter}
                    </span>
                  ) : null}
                  <span className="sr-only">{label}</span>
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
        {LEGEND.map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded text-[0.5rem] font-bold",
                DAY_STYLE[status].className,
              )}
              aria-hidden
            >
              {DAY_STYLE[status].letter}
            </span>
            {ATTENDANCE_STATUS_LABELS[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}
