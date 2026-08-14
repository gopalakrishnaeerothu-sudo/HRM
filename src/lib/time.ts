/**
 * Timezone-aware date helpers.
 *
 * Attendance is inherently local: an employee in the Hyderabad office checks
 * in at 09:00 *their* time, and their attendance row must land on their
 * calendar day — not the server's. Every function here takes an explicit IANA
 * timezone rather than relying on the process timezone, which on Railway is
 * UTC and on a developer's laptop is anything at all.
 *
 * Implemented with `Intl.DateTimeFormat` so there is no date-library
 * dependency in the code path that decides what a working day is.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Break an instant into its wall-clock parts in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "0";

  // Intl renders midnight as "24" in some engines; normalise to 0.
  const hour = Number(lookup("hour")) % 24;

  return {
    year: Number(lookup("year")),
    month: Number(lookup("month")),
    day: Number(lookup("day")),
    hour,
    minute: Number(lookup("minute")),
    second: Number(lookup("second")),
    weekday: WEEKDAY_INDEX[lookup("weekday")] ?? 1,
  };
}

/**
 * The calendar day an instant falls on in `timeZone`, as midnight UTC.
 *
 * This is the value stored in `attendance_records.date`. Anchoring to midnight
 * UTC keeps the DATE column stable regardless of where the query runs.
 */
export function zonedDateKey(instant: Date, timeZone: string): Date {
  const { year, month, day } = zonedParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Minutes since local midnight — the unit working hours are stored in. */
export function zonedMinutesOfDay(instant: Date, timeZone: string): number {
  const { hour, minute } = zonedParts(instant, timeZone);
  return hour * 60 + minute;
}

/** ISO weekday (1 = Mon … 7 = Sun) in `timeZone`. */
export function zonedWeekday(instant: Date, timeZone: string): number {
  return zonedParts(instant, timeZone).weekday;
}

/** Whether the instant falls on a configured weekend day. */
export function isWeekend(instant: Date, timeZone: string, weekendDays: readonly number[]): boolean {
  return weekendDays.includes(zonedWeekday(instant, timeZone));
}

// --- Plain date arithmetic (on midnight-UTC date keys) ----------------------

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

/** Inclusive list of date keys between two days. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  // Guard against an inverted range producing an unbounded loop.
  while (cursor <= end && days.length < 400) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Monday-anchored week start for a date key. */
export function startOfWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  return addDays(day, 1 - isoWeekday);
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / 86_400_000);
}

// --- Display ----------------------------------------------------------------

const DISPLAY_TZ_FALLBACK = "Asia/Kolkata";

/** "08 Aug 2026" */
export function formatDate(date: Date, timeZone = DISPLAY_TZ_FALLBACK): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "Sat, 08 Aug" */
export function formatDayLabel(date: Date, timeZone = DISPLAY_TZ_FALLBACK): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

/** "09:14 AM" */
export function formatTime(date: Date, timeZone = DISPLAY_TZ_FALLBACK): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "08 Aug 2026, 09:14 AM" */
export function formatDateTime(date: Date, timeZone = DISPLAY_TZ_FALLBACK): string {
  return `${formatDate(date, timeZone)}, ${formatTime(date, timeZone)}`;
}

/** "in 3 days" / "2 hours ago". Coarse by design — used in activity feeds. */
export function formatRelative(date: Date, now = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (absMs < minute) return "just now";
  if (absMs < hour) return formatter.format(Math.round(diffMs / minute), "minute");
  if (absMs < day) return formatter.format(Math.round(diffMs / hour), "hour");
  if (absMs < week) return formatter.format(Math.round(diffMs / day), "day");
  if (absMs < month) return formatter.format(Math.round(diffMs / week), "week");
  return formatter.format(Math.round(diffMs / month), "month");
}

/** Greeting used on the employee dashboard, in the viewer's own timezone. */
export function greetingFor(instant: Date, timeZone: string): string {
  const { hour } = zonedParts(instant, timeZone);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
