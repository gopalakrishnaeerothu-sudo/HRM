/**
 * Chart tokens for the JS charting layer.
 *
 * The values are CSS variable references, not hex, so a chart re-paints with
 * the theme without React re-rendering. Every consumer reads a slot by role;
 * nothing picks a colour by series index at random.
 *
 * The underlying palette is the validated eight-slot categorical set defined
 * in globals.css. Slots are assigned in fixed order and never cycled — past
 * eight categories the data is folded into "Other" (see `foldSeries`).
 */

export const SERIES_SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

/** Forms that plot every pair against every other (scatter, bubble) are held
 *  to the all-pairs gate, which only the first three slots clear. */
export const ALL_PAIRS_SAFE_SLOTS = SERIES_SLOTS.slice(0, 3);

export const chartInk = {
  primary: "var(--ink)",
  secondary: "var(--ink-secondary)",
  muted: "var(--ink-muted)",
  grid: "var(--grid-line)",
  axis: "var(--axis-line)",
  surface: "var(--surface-1)",
} as const;

/** Reserved state colours. Never used for a data series. */
export const statusColor = {
  good: "var(--success)",
  warning: "var(--warning)",
  serious: "var(--serious)",
  critical: "var(--critical)",
  info: "var(--info)",
  neutral: "var(--ink-muted)",
} as const;

export type StatusTone = keyof typeof statusColor;

/** Sequential ramp for magnitude encodings (heatmaps, utilisation cells). */
export const sequentialBlue = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#2a78d6",
  "#1c5cab",
  "#104281",
] as const;

/** Pick the fixed slot for series index `i`. */
export function seriesColor(index: number): string {
  return SERIES_SLOTS[index % SERIES_SLOTS.length];
}

/**
 * Cap a categorical dataset at `limit` slots, rolling the tail into a single
 * "Other" bucket. Prevents the palette from ever being cycled.
 */
export function foldSeries<T>(
  items: readonly T[],
  valueOf: (item: T) => number,
  labelOf: (item: T) => string,
  limit = 7,
): Array<{ label: string; value: number; isOther: boolean }> {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  if (sorted.length <= limit + 1) {
    return sorted.map((item) => ({ label: labelOf(item), value: valueOf(item), isOther: false }));
  }
  const head = sorted.slice(0, limit).map((item) => ({
    label: labelOf(item),
    value: valueOf(item),
    isOther: false,
  }));
  const otherTotal = sorted.slice(limit).reduce((sum, item) => sum + valueOf(item), 0);
  return [...head, { label: "Other", value: otherTotal, isOther: true }];
}

/** Shared Recharts axis styling so every chart in the product matches. */
export const axisProps = {
  tick: { fill: chartInk.muted, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: chartInk.axis },
} as const;

export const gridProps = {
  stroke: chartInk.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;
