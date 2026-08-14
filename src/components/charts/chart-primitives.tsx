"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared chart chrome.
 *
 * Rules encoded here rather than repeated per chart:
 *  - A legend is always present for two or more series, so identity is never
 *    carried by colour alone.
 *  - Tooltips use text tokens for the label and value; the series colour
 *    appears only as a small swatch beside them.
 *  - Every chart lives inside a fixed-height box, so a container that has not
 *    measured yet cannot collapse the layout.
 */

export function ChartFrame({
  title,
  description,
  legend,
  action,
  height = 280,
  children,
  className,
}: {
  title: string;
  description?: string;
  legend?: Array<{ label: string; color: string }>;
  action?: React.ReactNode;
  height?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass-card flex flex-col p-5 sm:p-6", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>
        {action}
      </header>

      {legend && legend.length > 0 ? (
        <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: entry.color }}
                aria-hidden
              />
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Fixed height: ResponsiveContainer needs a measured parent, and a
          percentage height inside a flex column collapses to zero. */}
      <div className="mt-5 w-full" style={{ height }}>
        {children}
      </div>
    </section>
  );
}

export interface TooltipEntry {
  label: string;
  value: string;
  color?: string;
}

/** Consistent tooltip body used by every chart in the product. */
export function ChartTooltip({ title, entries }: { title: string; entries: TooltipEntry[] }) {
  return (
    <div className="pointer-events-none rounded-lg border border-line bg-surface-1 px-3 py-2 shadow-float">
      <p className="text-xs font-semibold text-ink">{title}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.label} className="flex items-center gap-2 text-xs">
            {entry.color ? (
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: entry.color }}
                aria-hidden
              />
            ) : null}
            <span className="text-ink-muted">{entry.label}</span>
            <span className="ml-auto pl-3 font-medium tabular text-ink">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Accessible fallback: the same numbers as a table.
 *
 * Rendered visually hidden by default and revealed by the "View as table"
 * toggle, so the data is reachable without relying on the chart.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
  visible,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  visible: boolean;
}) {
  return (
    <div className={cn("table-scroll mt-4", !visible && "sr-only")}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted",
                  index === 0 ? "text-left" : "text-right",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "px-3 py-2 text-ink",
                    cellIndex === 0 ? "text-left" : "text-right tabular",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Toggle that reveals `ChartDataTable`. */
export function TableViewToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!visible)}
      aria-pressed={visible}
      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      {visible ? "Hide table" : "View as table"}
    </button>
  );
}
