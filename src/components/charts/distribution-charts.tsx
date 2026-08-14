"use client";

import * as React from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatNumber } from "@/lib/utils";
import { axisProps, seriesColor } from "@/lib/design/chart";
import {
  ChartDataTable,
  ChartFrame,
  ChartTooltip,
  TableViewToggle,
} from "@/components/charts/chart-primitives";

/**
 * Head count / workload by department.
 *
 * Horizontal bars, because department names are long and would otherwise be
 * rotated or truncated on the x-axis. Values are direct-labelled at the end of
 * each bar, so no tooltip hunting is needed to read the number.
 */

export interface DistributionDatum {
  name: string;
  count: number;
  openTasks?: number;
}

export function DepartmentDistributionChart({
  data,
  title = "Head count by department",
  description,
}: {
  data: DistributionDatum[];
  title?: string;
  description?: string;
}) {
  const [showTable, setShowTable] = React.useState(false);
  const sorted = React.useMemo(() => [...data].sort((a, b) => b.count - a.count), [data]);

  // Height grows with the row count so bars keep a consistent thickness
  // instead of stretching to fill a fixed box.
  const height = Math.max(200, sorted.length * 44 + 24);

  return (
    <ChartFrame
      title={title}
      description={description}
      action={<TableViewToggle visible={showTable} onToggle={setShowTable} />}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            {...axisProps}
            axisLine={false}
            tick={{ fill: "var(--ink-secondary)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const datum = payload[0]?.payload as DistributionDatum | undefined;
              if (!datum) return null;
              return (
                <ChartTooltip
                  title={datum.name}
                  entries={[
                    { label: "People", value: formatNumber(datum.count) },
                    ...(datum.openTasks !== undefined
                      ? [{ label: "Open tasks", value: formatNumber(datum.openTasks) }]
                      : []),
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            barSize={18}
            isAnimationActive={false}
            label={{
              position: "right",
              fill: "var(--ink-secondary)",
              fontSize: 12,
              formatter: (value: number) => formatNumber(value),
            }}
          >
            {sorted.map((entry, index) => (
              // Colour follows the department, assigned in fixed slot order.
              <Cell key={entry.name} fill={seriesColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <ChartDataTable
        visible={showTable}
        caption={title}
        columns={["Department", "People", ...(sorted[0]?.openTasks !== undefined ? ["Open tasks"] : [])]}
        rows={sorted.map((entry) => [
          entry.name,
          entry.count,
          ...(entry.openTasks !== undefined ? [entry.openTasks] : []),
        ])}
      />
    </ChartFrame>
  );
}

/**
 * Working hours per employee. Single series, so no legend box — the title
 * names what is plotted.
 */
export interface HoursDatum {
  name: string;
  hours: number;
  overtimeHours: number;
}

export function WorkingHoursChart({ data }: { data: HoursDatum[] }) {
  const [showTable, setShowTable] = React.useState(false);
  const top = React.useMemo(() => [...data].sort((a, b) => b.hours - a.hours).slice(0, 10), [data]);
  const height = Math.max(220, top.length * 40 + 24);

  return (
    <ChartFrame
      title="Working hours"
      description="Top 10 by total hours in the selected period."
      legend={[
        { label: "Regular", color: "var(--series-1)" },
        { label: "Overtime", color: "var(--series-2)" },
      ]}
      action={<TableViewToggle visible={showTable} onToggle={setShowTable} />}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={128}
            {...axisProps}
            axisLine={false}
            tick={{ fill: "var(--ink-secondary)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const datum = payload[0]?.payload as HoursDatum | undefined;
              if (!datum) return null;
              return (
                <ChartTooltip
                  title={datum.name}
                  entries={[
                    { label: "Regular", value: `${datum.hours.toFixed(1)} h`, color: "var(--series-1)" },
                    { label: "Overtime", value: `${datum.overtimeHours.toFixed(1)} h`, color: "var(--series-2)" },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="hours"
            stackId="hours"
            fill="var(--series-1)"
            barSize={16}
            stroke="var(--surface-1)"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Bar
            dataKey="overtimeHours"
            stackId="hours"
            fill="var(--series-2)"
            barSize={16}
            radius={[0, 4, 4, 0]}
            stroke="var(--surface-1)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>

      <ChartDataTable
        visible={showTable}
        caption="Working hours by employee"
        columns={["Employee", "Regular (h)", "Overtime (h)"]}
        rows={top.map((entry) => [entry.name, entry.hours.toFixed(1), entry.overtimeHours.toFixed(1)])}
      />
    </ChartFrame>
  );
}
