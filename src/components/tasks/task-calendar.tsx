"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { branding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { addDays, endOfMonth, startOfMonth, startOfUtcDay } from "@/lib/time";
import type { TaskSummary } from "@/server/repositories/task-repository";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Month calendar of task due dates.
 *
 * Built on plain UTC date arithmetic rather than a calendar library — the grid
 * is always six weeks from the Monday on or before the 1st, which keeps the
 * cell height stable across months instead of the layout jumping between five
 * and six rows.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PRIORITY_DOT = {
  URGENT: "bg-critical",
  HIGH: "bg-warning",
  MEDIUM: "bg-info",
  LOW: "bg-ink-muted",
} as const;

export function TaskCalendar({ tasks }: { tasks: TaskSummary[] }) {
  const [monthAnchor, setMonthAnchor] = React.useState(() => startOfMonth(new Date()));

  const { cells, monthLabel } = React.useMemo(() => {
    const first = startOfMonth(monthAnchor);
    const last = endOfMonth(monthAnchor);

    // Back up to the Monday of the week containing the 1st.
    const firstWeekday = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
    const gridStart = addDays(first, 1 - firstWeekday);

    const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));

    return {
      cells: days.map((date) => ({
        date,
        inMonth: date >= first && date <= last,
      })),
      monthLabel: new Intl.DateTimeFormat("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(first),
    };
  }, [monthAnchor]);

  const tasksByDay = React.useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const key = startOfUtcDay(new Date(task.dueDate)).toISOString().slice(0, 10);
      const bucket = map.get(key) ?? [];
      bucket.push(task);
      map.set(key, bucket);
    }
    return map;
  }, [tasks]);

  const todayKey = startOfUtcDay(new Date()).toISOString().slice(0, 10);
  const undated = tasks.filter((task) => !task.dueDate);

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h3 className="text-base font-semibold tracking-tight text-ink">{monthLabel}</h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMonthAnchor((current) => startOfMonth(addDays(current, -1)))}
              aria-label="Previous month"
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMonthAnchor(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMonthAnchor((current) => startOfMonth(addDays(endOfMonth(current), 1)))}
              aria-label="Next month"
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>

        {/* Weekday header, hidden on very narrow screens where the grid
            becomes a two-column list. */}
        <div className="hidden grid-cols-7 border-b border-line sm:grid">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-7">
          {cells.map(({ date, inMonth }) => {
            const key = date.toISOString().slice(0, 10);
            const dayTasks = tasksByDay.get(key) ?? [];
            const isToday = key === todayKey;

            // On mobile, empty out-of-month cells are noise; drop them.
            if (!inMonth && dayTasks.length === 0) {
              return (
                <div
                  key={key}
                  className="hidden min-h-[6.5rem] border-b border-r border-line bg-surface-2/30 p-2 last:border-r-0 sm:block"
                  aria-hidden
                />
              );
            }

            return (
              <div
                key={key}
                className={cn(
                  "min-h-[6.5rem] border-b border-r border-line p-2",
                  !inMonth && "bg-surface-2/30",
                  isToday && "bg-brand-soft/40",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular",
                      isToday ? "bg-brand font-semibold text-white" : "text-ink-muted",
                    )}
                  >
                    {date.getUTCDate()}
                  </span>
                  {dayTasks.length > 2 ? (
                    <span className="text-[0.625rem] text-ink-muted">+{dayTasks.length - 2}</span>
                  ) : null}
                </div>

                <ul className="mt-1.5 flex flex-col gap-1">
                  {dayTasks.slice(0, 2).map((task) => (
                    <li key={task.id}>
                      <Link
                        href={`/app/tasks/${task.id}`}
                        className="flex items-start gap-1.5 rounded-md bg-surface-2 px-1.5 py-1 transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                      >
                        <span
                          className={cn(
                            "mt-1 size-1.5 shrink-0 rounded-full",
                            PRIORITY_DOT[task.priority],
                          )}
                          aria-hidden
                        />
                        <span className="line-clamp-2-safe text-[0.6875rem] leading-tight text-ink">
                          {task.title}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      {undated.length > 0 ? (
        <Card className="p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-ink">No due date · {undated.length}</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {undated.slice(0, 12).map((task) => (
              <li key={task.id}>
                <Link
                  href={`/app/tasks/${task.id}`}
                  className="flex max-w-full items-center gap-2 rounded-full border border-line px-2.5 py-1 text-xs transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
                >
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
                    aria-hidden
                  />
                  <span className="truncate text-ink-secondary">
                    {branding.taskPrefix}-{task.reference} · {task.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
