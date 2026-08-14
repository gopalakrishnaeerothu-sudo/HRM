"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/utils";
import { axisProps, chartInk, gridProps } from "@/lib/design/chart";
import {
  ChartDataTable,
  ChartFrame,
  ChartTooltip,
  TableViewToggle,
} from "@/components/charts/chart-primitives";

/**
 * Attendance over time.
 *
 * Stacked bars, because the question is "how did the day break down" — a
 * composition, not four independent lines. Segments carry a 2px surface gap so
 * adjacent categories stay separable for colour-vision-deficient readers.
 */

export interface AttendancePoint {
  date: string;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
}

const SERIES = [
  { key: "present", label: "Present", color: "var(--series-1)" },
  { key: "late", label: "Late", color: "var(--series-2)" },
  { key: "onLeave", label: "On leave", color: "var(--series-3)" },
  { key: "absent", label: "Absent", color: "var(--series-8)" },
] as const;

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(date);
}

export function AttendanceTrendChart({ data }: { data: AttendancePoint[] }) {
  const [showTable, setShowTable] = React.useState(false);

  return (
    <ChartFrame
      title="Attendance trend"
      description="Daily breakdown across the organisation."
      legend={SERIES.map((series) => ({ label: series.label, color: series.color }))}
      action={<TableViewToggle visible={showTable} onToggle={setShowTable} />}
      height={288}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} {...axisProps} width={44} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltip
                  title={shortDate(String(label))}
                  entries={payload.map((entry) => ({
                    label: SERIES.find((series) => series.key === entry.dataKey)?.label ?? String(entry.dataKey),
                    value: formatNumber(Number(entry.value ?? 0)),
                    color: entry.color,
                  }))}
                />
              );
            }}
          />
          {SERIES.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              stackId="attendance"
              fill={series.color}
              // 2px surface-coloured gap between stacked segments.
              stroke={chartInk.surface}
              strokeWidth={2}
              radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <ChartDataTable
        visible={showTable}
        caption="Attendance by day"
        columns={["Date", "Present", "Late", "On leave", "Absent"]}
        rows={data.map((point) => [
          shortDate(point.date),
          point.present,
          point.late,
          point.onLeave,
          point.absent,
        ])}
      />
    </ChartFrame>
  );
}

/** Tasks created vs completed. Two series, so a legend is mandatory. */
export interface TaskTrendPoint {
  date: string;
  created: number;
  completed: number;
}

export function TaskTrendChart({ data }: { data: TaskTrendPoint[] }) {
  const [showTable, setShowTable] = React.useState(false);

  const legend = [
    { label: "Created", color: "var(--series-1)" },
    { label: "Completed", color: "var(--series-3)" },
  ];

  return (
    <ChartFrame
      title="Task flow"
      description="Tasks opened against tasks closed."
      legend={legend}
      action={<TableViewToggle visible={showTable} onToggle={setShowTable} />}
      height={288}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="created-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="completed-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-3)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--series-3)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} {...axisProps} width={44} />
          <Tooltip
            cursor={{ stroke: chartInk.axis, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltip
                  title={shortDate(String(label))}
                  entries={payload.map((entry) => ({
                    label: entry.dataKey === "created" ? "Created" : "Completed",
                    value: formatNumber(Number(entry.value ?? 0)),
                    color: entry.color,
                  }))}
                />
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="created"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="url(#created-fill)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="completed"
            stroke="var(--series-3)"
            strokeWidth={2}
            fill="url(#completed-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <ChartDataTable
        visible={showTable}
        caption="Tasks created and completed by day"
        columns={["Date", "Created", "Completed"]}
        rows={data.map((point) => [shortDate(point.date), point.created, point.completed])}
      />
    </ChartFrame>
  );
}
