import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status is never carried by colour alone: every tone variant is paired with
 * a text label, and `StatusDot` adds a shape cue for the compact case.
 */
const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium leading-none transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-surface-2 text-ink-secondary",
        brand: "border-transparent bg-brand-soft text-brand",
        info: "border-transparent bg-info-soft text-info",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        serious: "border-transparent bg-serious-soft text-serious",
        critical: "border-transparent bg-critical-soft text-critical",
        outline: "border-line-strong bg-transparent text-ink-secondary",
      },
      size: {
        sm: "px-2 py-0.5 text-[0.6875rem]",
        md: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), "truncate", className)} {...props} />;
}

const dotTone = {
  neutral: "bg-ink-muted",
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  serious: "bg-serious",
  critical: "bg-critical",
} as const;

export type DotTone = keyof typeof dotTone;

/** Small state indicator. Always rendered next to a text label. */
export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: DotTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative flex size-2 shrink-0", className)} aria-hidden>
      {pulse ? (
        <span
          className={cn("absolute inline-flex size-full rounded-full opacity-60", dotTone[tone])}
          style={{ animation: "pulse-ring 2.6s var(--ease-in-out-soft) infinite" }}
        />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", dotTone[tone])} />
    </span>
  );
}

export { badgeVariants };
