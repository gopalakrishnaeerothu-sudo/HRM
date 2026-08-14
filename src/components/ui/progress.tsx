"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn, clamp } from "@/lib/utils";

const toneClasses = {
  brand: "brand-gradient",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-info",
  neutral: "bg-ink-muted",
} as const;

export type ProgressTone = keyof typeof toneClasses;

const sizeClasses = {
  sm: "h-1.5",
  md: "h-2",
  lg: "h-2.5",
} as const;

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** 0–100. Clamped, so a bad value can never overflow the track. */
  value: number;
  tone?: ProgressTone;
  barSize?: keyof typeof sizeClasses;
  /** Accessible name; required because the bar itself has no visible label. */
  label: string;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, tone = "brand", barSize = "md", label, ...props }, ref) => {
    const pct = clamp(Math.round(value), 0, 100);
    return (
      <ProgressPrimitive.Root
        ref={ref}
        value={pct}
        aria-label={label}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-surface-3",
          sizeClasses[barSize],
          className,
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-quint)]", toneClasses[tone])}
          style={{ width: `${pct}%` }}
        />
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = "Progress";

/**
 * Circular progress dial used by the attendance widgets. Pure SVG so it
 * animates cheaply and prints correctly.
 */
export function ProgressRing({
  value,
  size = 120,
  strokeWidth = 10,
  tone = "brand",
  label,
  children,
  className,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: ProgressTone;
  label: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const pct = clamp(value, 0, 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  const strokeColor =
    tone === "brand"
      ? "var(--brand)"
      : tone === "success"
        ? "var(--success)"
        : tone === "warning"
          ? "var(--warning)"
          : tone === "critical"
            ? "var(--critical)"
            : tone === "info"
              ? "var(--info)"
              : "var(--ink-muted)";

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(pct)}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-[stroke-dasharray] duration-1000 ease-[var(--ease-out-quint)]"
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export { Progress };
