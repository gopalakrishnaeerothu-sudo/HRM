"use client";

import * as React from "react";
import { animate, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { cn, formatNumber } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * The KPI tile used across every dashboard.
 *
 * A hero number needs no plot, so this is deliberately not a chart: one large
 * figure, one label, one optional delta with an arrow *and* a word, never
 * colour alone. Fixed height keeps a row of tiles aligned even when one label
 * wraps to two lines.
 */

const accentClasses = {
  brand: "text-brand bg-brand-soft",
  info: "text-info bg-info-soft",
  success: "text-success bg-success-soft",
  warning: "text-warning bg-warning-soft",
  serious: "text-serious bg-serious-soft",
  critical: "text-critical bg-critical-soft",
  neutral: "text-ink-secondary bg-surface-2",
} as const;

export type StatAccent = keyof typeof accentClasses;

export interface StatCardProps {
  label: string;
  value: number;
  /** Appended to the value, e.g. "%" or "h". */
  suffix?: string;
  /** Rendered before the value, e.g. "₹". */
  prefix?: string;
  /**
   * Rendered element, NOT a component reference.
   *
   * This is a Client Component, and most callers are Server Components. React
   * cannot serialise a function across that boundary, so `icon={<Users />}`
   * works where `icon={Users}` throws at runtime.
   */
  icon?: React.ReactNode;
  accent?: StatAccent;
  /** Percentage-point change vs. the comparison period. */
  delta?: number;
  deltaLabel?: string;
  /** When true, a falling value is the good outcome (e.g. overdue tasks). */
  invertDelta?: boolean;
  hint?: string;
  footer?: React.ReactNode;
  className?: string;
}

/** Counts up to `value` on mount; static when the OS asks for reduced motion. */
function useCountUp(value: number, enabled: boolean) {
  const [display, setDisplay] = React.useState(enabled ? 0 : value);

  React.useEffect(() => {
    if (!enabled) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [value, enabled]);

  return display;
}

export function StatCard({
  label,
  value,
  suffix,
  prefix,
  icon,
  accent = "brand",
  delta,
  deltaLabel,
  invertDelta = false,
  hint,
  footer,
  className,
}: StatCardProps) {
  const reduceMotion = useReducedMotion();
  const display = useCountUp(value, !reduceMotion);
  const isFractional = !Number.isInteger(value);

  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const rising = hasDelta && delta > 0;
  const flat = hasDelta && Math.abs(delta) < 0.05;
  const good = invertDelta ? !rising : rising;

  const DeltaIcon = flat ? ArrowRight : rising ? ArrowUpRight : ArrowDownRight;
  const deltaWord = flat ? "no change" : rising ? "up" : "down";

  return (
    <div
      className={cn(
        "glass-card group flex min-h-[7.75rem] flex-col justify-between gap-3 p-5",
        "transition-transform duration-300 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-tight text-ink-muted">{label}</p>
        {icon ? (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-105",
              "[&_svg]:size-[1.125rem]",
              accentClasses[accent],
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>

      <p className="flex items-baseline gap-0.5 text-3xl font-semibold leading-none tracking-tight text-ink">
        {prefix ? <span className="text-xl text-ink-secondary">{prefix}</span> : null}
        <span>{formatNumber(display, isFractional ? 1 : 0)}</span>
        {suffix ? <span className="text-lg font-medium text-ink-secondary">{suffix}</span> : null}
      </p>

      {hasDelta ? (
        <Tooltip content={hint}>
          <p className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium",
                flat
                  ? "bg-surface-2 text-ink-secondary"
                  : good
                    ? "bg-success-soft text-success"
                    : "bg-critical-soft text-critical",
              )}
            >
              <DeltaIcon className="size-3" aria-hidden />
              {/* The word carries the direction so colour is never the only cue. */}
              <span className="sr-only">{deltaWord} </span>
              {Math.abs(delta).toFixed(1)}%
            </span>
            <span className="min-w-0 truncate text-ink-muted">{deltaLabel ?? "vs last period"}</span>
          </p>
        </Tooltip>
      ) : footer ? (
        <div className="text-xs text-ink-muted">{footer}</div>
      ) : (
        <div className="h-4" aria-hidden />
      )}
    </div>
  );
}

/** Responsive KPI row: 1 col on phones, 2 on tablets, 4 on desktop. */
export function StatGrid({
  className,
  columns = 4,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}
